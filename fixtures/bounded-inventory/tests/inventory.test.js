const assert = require("node:assert/strict");
const { test } = require("node:test");
const { resolve } = require("node:path");
const { inventoryTotal } = require(resolve(__dirname, "../../../dist/fixtures/bounded-inventory/src/inventory.js"));

test("totals whole-price inventory lines", () => {
  assert.equal(inventoryTotal([{ quantity: 2, unitPrice: 3 }, { quantity: 1, unitPrice: 5 }]), 11);
});
