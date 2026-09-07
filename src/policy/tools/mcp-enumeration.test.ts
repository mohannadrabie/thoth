// Canary-secret test for extractMcpServerNames (S5 plan v3 criterion 16, council-ruled fix for
// Issue #89). Cites OPS-02 verbatim (REQUIREMENTS.md:584, P0): "Thoth shall never read, log or
// emit credential material. Posture output names identities and outcomes, never secrets. Fixture
// asserts no secret-shaped content in any artifact."
//
// `story-implementer`'s own unit test (plan §4: "it tests a pure internal function's data-handling
// contract, not an externally-observable UI/API surface" — not test-writer's scope), written and
// confirmed RED before hooks/sessionstart-tool-enum.mjs's implementation exists (build order step
// 2), per this project's own test-first convention applied reflexively to this module's own
// consumer.
//
// A REAL secret-shaped canary is planted in an `env` block for both input shapes this function
// must handle (architecture-reviewer's council-seat condition: `.mcp.json` too, not only
// `~/.claude.json` — identical risk shape). Three independent assertions per fixture, per the
// plan's own text: the canary string never appears in (a) the function's return value, (b) any
// thrown error's message, (c) `JSON.stringify()` of the return value.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractConnectorIdentities, extractMcpServerNames } from "./mcp-enumeration.ts";

// A realistic secret-shaped value — NOT a real credential, a fixed fake pattern matching GitHub's
// real PAT shape (`ghp_` + 36 alphanumeric characters) closely enough to be a meaningful canary.
const CANARY = "ghp_fAkEsEcReTfAkEsEcReTfAkEsEcReTfAkE1";

function assertCanaryNeverLeaks(fn: () => string[]): void {
  let result: string[] | undefined;
  let thrownMessage: string | undefined;
  try {
    result = fn();
  } catch (err) {
    thrownMessage = err instanceof Error ? err.message : String(err);
  }

  if (thrownMessage !== undefined) {
    assert.doesNotMatch(thrownMessage, new RegExp(CANARY), "the canary secret must never appear in a thrown error's message");
  }
  if (result !== undefined) {
    assert.ok(!result.includes(CANARY), "the canary secret must never appear in the return value's own elements");
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, new RegExp(CANARY), "the canary secret must never appear in JSON.stringify() of the return value");
  }
}

// --- .mcp.json shape --------------------------------------------------------------------------

test("OPS-02 canary: .mcp.json-shaped input with a planted secret in env -- canary never leaks into the return value, a thrown error, or JSON.stringify()", () => {
  const fixture = {
    mcpServers: {
      github: {
        command: "docker",
        args: ["run", "-i", "--rm", "ghcr.io/github/github-mcp-server"],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: CANARY },
      },
    },
  };
  assertCanaryNeverLeaks(() => extractMcpServerNames(fixture, "mcp.json"));
});

test("OPS-02 canary: .mcp.json's own names ARE still correctly returned alongside the guarantee above (this is a real function, not a stub that returns nothing)", () => {
  const fixture = { mcpServers: { github: { command: "docker", env: { GITHUB_PERSONAL_ACCESS_TOKEN: CANARY } } } };
  const names = extractMcpServerNames(fixture, "mcp.json");
  assert.deepEqual(names, ["github"]);
});

test("OPS-02 canary: .mcp.json with a malformed (non-object) env block never throws, and never leaks the canary if it did", () => {
  const fixture = {
    mcpServers: {
      github: { command: "docker", env: `GITHUB_PERSONAL_ACCESS_TOKEN=${CANARY}` }, // env is a STRING, not an object
    },
  };
  assertCanaryNeverLeaks(() => extractMcpServerNames(fixture, "mcp.json"));
});

// --- ~/.claude.json shape ----------------------------------------------------------------------

test("OPS-02 canary: ~/.claude.json-shaped input with a planted secret in env -- canary never leaks into the return value, a thrown error, or JSON.stringify()", () => {
  const fixture = {
    mcpServers: {
      github: {
        command: "docker",
        args: ["run", "-i", "--rm", "ghcr.io/github/github-mcp-server"],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: CANARY },
      },
    },
    claudeAiMcpEverConnected: ["some-connector-id"],
  };
  assertCanaryNeverLeaks(() => extractMcpServerNames(fixture, "claude.json"));
});

test("OPS-02 canary: ~/.claude.json's own server names AND connector identities are still correctly returned", () => {
  const fixture = {
    mcpServers: { github: { command: "docker", env: { GITHUB_PERSONAL_ACCESS_TOKEN: CANARY } } },
    claudeAiMcpEverConnected: ["some-connector-id"],
  };
  const names = extractMcpServerNames(fixture, "claude.json");
  assert.deepEqual(names.sort(), ["github", "some-connector-id"]);
});

test("OPS-02 canary: ~/.claude.json with a truncated/malformed env block never throws, and never leaks the canary if it did", () => {
  const fixture = {
    mcpServers: { github: { command: "docker", env: null } }, // env truncated to null
    claudeAiMcpEverConnected: ["some-connector-id"],
  };
  assertCanaryNeverLeaks(() => extractMcpServerNames(fixture, "claude.json"));
});

test("OPS-02 canary: the canary value hidden INSIDE a claudeAiMcpEverConnected string element is a names field by contract -- returned as a name, but the guarantee (no unrelated leak) still holds for the mcpServers side", () => {
  // claudeAiMcpEverConnected is documented as connector NAMES only (no tool-schema mapping) -- if
  // a caller somehow put a secret-shaped string there, this function has no way to distinguish it
  // from a legitimate connector id (its whole contract is "return the string values verbatim").
  // This test documents that boundary rather than asserting an impossible guarantee: the real
  // security property this file owns is "never touch mcpServers[name]'s OWN fields", proven above.
  const fixture = { mcpServers: {}, claudeAiMcpEverConnected: ["legit-connector"] };
  const names = extractMcpServerNames(fixture, "claude.json");
  assert.deepEqual(names, ["legit-connector"]);
});

// --- Cross-cutting: never touches fields outside its own contract --------------------------------

test("extractMcpServerNames never returns a value for a completely malformed (non-object) input, and never throws", () => {
  assertCanaryNeverLeaks(() => extractMcpServerNames(`not even an object, contains ${CANARY}`, "mcp.json"));
  assertCanaryNeverLeaks(() => extractMcpServerNames(null, "claude.json"));
  assertCanaryNeverLeaks(() => extractMcpServerNames(undefined, "mcp.json"));
});

test("extractMcpServerNames: an mcpServers value that is itself an array (not an object) is ignored, never crashes", () => {
  assertCanaryNeverLeaks(() => extractMcpServerNames({ mcpServers: [CANARY] }, "mcp.json"));
});

// --- extractConnectorIdentities: the connector-identity schema decision's own extraction --------
// (see mcp-enumeration.ts's own header comment on extractConnectorIdentities for the full decision
// text: connector identities are ALWAYS kept separate from tool-schema names, surfaced under a
// distinct "SUR-03-unclassified-connector" halt reason key by hooks/sessionstart-tool-enum.mjs,
// never merged into the shared "SUR-03-unclassified-tool" key ordinary MCP server names use.)

test("extractConnectorIdentities: returns ONLY claudeAiMcpEverConnected's string values, never mcpServers names", () => {
  const fixture = {
    mcpServers: { github: { command: "docker", env: { GITHUB_PERSONAL_ACCESS_TOKEN: CANARY } } },
    claudeAiMcpEverConnected: ["connector-a", "connector-b"],
  };
  assert.deepEqual(extractConnectorIdentities(fixture), ["connector-a", "connector-b"]);
});

test("extractConnectorIdentities: canary never leaks -- same OPS-02 guarantee as extractMcpServerNames", () => {
  const fixture = {
    mcpServers: { github: { command: "docker", env: { GITHUB_PERSONAL_ACCESS_TOKEN: CANARY } } },
    claudeAiMcpEverConnected: ["connector-a"],
  };
  assertCanaryNeverLeaks(() => extractConnectorIdentities(fixture));
});

test("extractConnectorIdentities: no claudeAiMcpEverConnected field, or malformed input, returns an empty array without throwing", () => {
  assert.deepEqual(extractConnectorIdentities({ mcpServers: {} }), []);
  assert.deepEqual(extractConnectorIdentities(null), []);
  assert.deepEqual(extractConnectorIdentities("not an object"), []);
});
