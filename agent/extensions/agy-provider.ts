import { spawn } from "node:child_process";
import * as readline from "node:readline";
import {
  createProvider,
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const AGY_API = "agy-cli";

export default function (pi: ExtensionAPI) {
  pi.registerProvider(createProvider({
    id: "agy",
    name: "Antigravity CLI",
    baseUrl: "local",
    // Shells out to the local agy CLI, which owns its own credentials — no key
    // to store, so this is ambient-only auth that is always "configured".
    auth: {
      apiKey: {
        name: "Antigravity CLI (local)",
        async resolve() {
          return { auth: { apiKey: "local" }, source: "local agy CLI" };
        },
      },
    },
    models: [
      {
        id: "gemini-3.7-flash",
        name: "Gemini 3.7 Flash (AGY)",
        api: AGY_API,
        provider: "agy",
        baseUrl: "local",
        reasoning: true,
        input: ["text"],
        contextWindow: 1000000,
        maxTokens: 8192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      }
    ],
    api: { [AGY_API]: {
      // The agy CLI is driven through a flattened text prompt, so there is no
      // tool-call channel — only the tool-less `*Simple` path works.
      stream(): never {
        throw new Error("agy provider does not implement the tool-calling stream API");
      },
      async completeSimple() {
        throw new Error("completeSimple not implemented");
      },
      streamSimple(model: Model<any>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
        const stream = createAssistantMessageEventStream();

        (async () => {
          const output: AssistantMessage = {
            role: "assistant",
            content: [],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "pending",
            timestamp: Date.now(),
          };

          try {
            stream.push({ type: "start", partial: output });

            // Flatten conversation history for the CLI prompt
            let promptText = context.system ? `System: ${context.system}\n\n` : '';
            promptText += context.messages.map(m => {
              const text = m.content.map(c => c.type === 'text' ? c.text : '').join('');
              return `${m.role}: ${text}`;
            }).join('\n\n');

            // Execute agy CLI in headless single-prompt mode
            const args = [
              "--dangerously-skip-permissions",
              "--print", promptText,
              "--output-format", "stream-json",
              "--model", model.id
            ];

            const child = spawn("agy", args, {
              env: { ...process.env, ANTHROPIC_API_KEY: '' }
            });

            const rl = readline.createInterface({ input: child.stdout });

            rl.on('line', (line) => {
              try {
                const data = JSON.parse(line);
                
                // Stream text deltas live
                if (data.event === "step_update" && data.step_update?.text_delta) {
                  output.content.push({ type: "text", text: data.step_update.text_delta });
                  stream.push({ type: "content", partial: output });
                }
                
                // Capture final success state and token usage
                if (data.event === "result") {
                  if (data.result?.status === "SUCCESS") {
                    output.stopReason = "stop";
                  } else {
                    output.stopReason = "error";
                    output.errorMessage = data.result?.error || "Unknown error";
                  }
                  if (data.result?.usage) {
                     output.usage.input = data.result.usage.input_tokens || 0;
                     output.usage.output = data.result.usage.output_tokens || 0;
                     output.usage.totalTokens = data.result.usage.total_tokens || 0;
                  }
                }
              } catch (e) {
                // Ignore parse errors from non-JSON stdout
              }
            });

            child.on('close', (code) => {
              if (output.stopReason === "pending") {
                output.stopReason = code === 0 ? "stop" : "error";
                if (code !== 0) output.errorMessage = `Process exited with code ${code}`;
              }

              if (output.stopReason === "error" || output.stopReason === "aborted") {
                stream.push({
                   type: "done",
                   reason: "error",
                   message: output,
                   error: new Error(output.errorMessage || "Process error")
                });
              } else {
                stream.push({
                   type: "done",
                   reason: output.stopReason as any,
                   message: output
                });
              }
            });

          } catch (e: any) {
            output.stopReason = "error";
            stream.push({
              type: "done",
              reason: "error",
              message: output,
              error: e
            });
          }
        })();

        return stream;
      }
    } }
  }));
}
