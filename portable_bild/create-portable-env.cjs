#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const destination = path.resolve(process.argv[2] || ".env");
const template = path.resolve(process.argv[3] || path.join(__dirname, ".env.template"));

if (fs.existsSync(destination)) process.exit(0);
if (!fs.existsSync(template)) {
  console.error(`[portable] Configuration template is missing: ${template}`);
  process.exit(1);
}

const secrets = [
  `JWT_SECRET=${crypto.randomBytes(32).toString("hex")}`,
  `JOB_SECRET=${crypto.randomBytes(24).toString("hex")}`,
];
fs.writeFileSync(destination, `${fs.readFileSync(template, "utf8").trim()}\n${secrets.join("\n")}\n`, {
  encoding: "utf8",
  mode: 0o600,
  flag: "wx",
});
console.log("[portable] A local .env file and unique offline secrets were created.");
