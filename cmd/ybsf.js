#!/usr/bin/env node

const { runCli } = require("../src/cli");

runCli(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    if (!(err && err.alreadyReported)) {
      console.error(err && err.message ? err.message : String(err));
    }
    process.exitCode = 1;
  });
