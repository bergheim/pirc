import assert from "node:assert/strict";
import test from "node:test";
import { findSkillHits, stripHits } from "./parse.ts";

const names = new Set(["j-save", "caveman", "ponytail", "blog-idea"]);

function hit(text: string) {
	return findSkillHits(text, names);
}

test("mid-sentence mention", () => {
	const hits = hit("yeah this is perfect. then $j-save full");
	assert.equal(hits.length, 1);
	assert.equal(hits[0].name, "j-save");
	assert.equal(hits[0].args, "full");
});

test("multi-hit and $a $b adjacency", () => {
	const hits = hit("$j-save a $caveman b");
	assert.equal(hits.length, 2);
	assert.deepEqual(
		hits.map((h) => [h.name, h.args]),
		[
			["j-save", "a"],
			["caveman", "b"],
		],
	);
});

test("unknown name and $5 / $PATH passthrough", () => {
	assert.equal(hit("$unknown x").length, 0);
	assert.equal(hit("price is $10").length, 0);
	assert.equal(hit("export $PATH").length, 0);
});

test("clause punctuation stops args; next $skill too", () => {
	const clause = hit("$j-save full; $ponytail");
	assert.equal(clause.length, 2);
	assert.equal(clause[0].args, "full");
	assert.equal(clause[1].name, "ponytail");
});

test("following lines are args, like /compact focus on trees", () => {
	const hits = hit("this is a $blog-idea\n\nabout adding inline skills");
	assert.equal(hits.length, 1);
	assert.equal(hits[0].name, "blog-idea");
	assert.equal(hits[0].args, "about adding inline skills");
	assert.equal(
		stripHits("this is a $blog-idea\n\nabout adding inline skills", hits),
		"this is a",
	);
});

test("same-line args hoist; prefix is remainder", () => {
	const text = "this is a $blog-idea about adding inline skills";
	const hits = hit(text);
	assert.equal(hits[0].args, "about adding inline skills");
	assert.equal(stripHits(text, hits), "this is a");
});

test("no whitespace after name does not swallow punctuation", () => {
	const hits = hit("$ponytail's rule applies");
	assert.equal(hits.length, 1);
	assert.equal(hits[0].args, "");
	assert.equal(hits[0].end, "$ponytail".length);
});
