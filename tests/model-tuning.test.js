"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const tuning = require("../model-tuning");

test("model tuning gives appearance-sensitive models a lower transfer strength", () => {
  assert.ok(tuning.referenceStrength("apollo", "nano-banana-2", "material") <
    tuning.referenceStrength("volc", "doubao-seedream-5-0-pro-260628", "material"));
});

test("atmosphere mode is always weaker than material inheritance", () => {
  for (const model of ["nano-banana-2", "seedream-v5-pro", "custom-image-model"]) {
    assert.ok(tuning.referenceStrength("custom", model, "atmosphere") <
      tuning.referenceStrength("custom", model, "material"));
  }
});

test("unknown models receive a complete safe default profile", () => {
  const profile = tuning.profileFor("custom", "future-model");
  assert.deepEqual(profile.supportedReferenceModes, ["atmosphere", "material"]);
  assert.equal(profile.defaultReferenceMode, "material");
  assert.equal(profile.structureGuard, "standard");
  assert.equal(tuning.referenceStrength("custom", "future-model", "material"), .62);
  assert.equal(tuning.promptFlavorFor("custom", "future-model"), "structured");
});

test("prompt flavor follows each model family", () => {
  assert.equal(tuning.promptFlavorFor("apollo", "nano-banana-2"), "natural");
  assert.equal(tuning.promptFlavorFor("volc", "doubao-seedream-5-0-pro-260628"), "keyword");
  assert.equal(tuning.promptFlavorFor("apollo", "gpt-image-2"), "structured");
  assert.equal(tuning.promptFlavorFor("custom", "flux-1.1-pro"), "concise");
});
