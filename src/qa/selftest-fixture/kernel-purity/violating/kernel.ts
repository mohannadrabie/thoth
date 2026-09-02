// Self-test fixture (kernel-purity-check.ts, VIOLATING case): deliberately breaks every rule
// kernel-purity-check.ts enforces, in one file, so its coverage of each violation class is
// provable in one place (see kernel-purity-check.test.ts):
//   1. a non-relative import ("node:fs" — a filesystem builtin, forbidden inside the boundary)
//   2. an out-of-directory relative import (reaching four levels up into src/lib/)
//   3. a forbidden global (`process.cwd()`)
import { readFile } from "node:fs/promises";
import { printInstrumentResult } from "../../../../lib/instrument.ts";

export function brokenKernelFn(): string {
  void readFile;
  void printInstrumentResult;
  return process.cwd();
}
