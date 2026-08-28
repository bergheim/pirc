export const CLOCK_TYPE = "clock";

export interface ClockData {
    t?: number;
    d?: number;
    /** In-flight run; renderer supplies live elapsed until settle. */
    live?: boolean;
}

export function clockDataForMessage(
    role: "user" | "assistant",
    t: number,
    liveEntryPending: boolean,
): { data: ClockData; liveEntryPending: boolean } {
    if (role === "user" && liveEntryPending) {
        return { data: { t, live: true }, liveEntryPending: false };
    }
    return { data: { t }, liveEntryPending };
}
