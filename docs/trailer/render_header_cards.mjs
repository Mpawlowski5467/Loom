#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "../../frontend/node_modules/playwright/index.mjs";

const outputDirectory =
  process.argv[2] ?? path.resolve("docs/trailer/header-cards");
const headers = [
  ["01-memory.png", "YOUR NOTES", "WOVEN INTO LIVING MEMORY"],
  ["02-local.png", "LOCAL-FIRST", "PLAIN MARKDOWN  /  YOUR FILES"],
  ["03-connections.png", "SEARCH LESS", "CONNECTIONS SURFACE THEMSELVES"],
  ["04-agents.png", "FIVE AGENTS", "ORGANIZE  /  LINK  /  VERIFY"],
  ["05-control.png", "YOU STAY IN CONTROL", "UNCERTAIN WORK WAITS FOR REVIEW"],
];

await fs.mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1280, height: 720 },
});

for (const [fileName, lead, detail] of headers) {
  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <style>
          * { box-sizing: border-box; }
          html, body {
            width: 1280px;
            height: 720px;
            margin: 0;
            overflow: hidden;
            background: transparent;
          }
          body {
            display: flex;
            justify-content: center;
            align-items: flex-start;
            padding-top: 52px;
            font-family: Arial, Helvetica, sans-serif;
          }
          .card {
            display: flex;
            align-items: baseline;
            gap: 15px;
            padding: 14px 20px 13px;
            color: #1a1815;
            background: rgba(245, 241, 232, 0.96);
            border: 1px solid rgba(26, 24, 21, 0.16);
            border-left: 5px solid #a83a2c;
            border-radius: 3px;
            box-shadow: 0 9px 30px rgba(26, 24, 21, 0.11);
          }
          .lead {
            font-size: 27px;
            font-weight: 800;
            letter-spacing: 0.07em;
          }
          .detail {
            color: #5c5851;
            font-size: 20px;
            font-weight: 700;
            letter-spacing: 0.06em;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <span class="lead">${lead}</span>
          <span class="detail">${detail}</span>
        </div>
      </body>
    </html>
  `);
  await page.screenshot({
    path: path.join(outputDirectory, fileName),
    omitBackground: true,
  });
}

await page.setContent(`
  <!doctype html>
  <html>
    <head>
      <style>
        * { box-sizing: border-box; }
        html, body {
          width: 1280px;
          height: 720px;
          margin: 0;
          overflow: hidden;
        }
        body {
          display: grid;
          place-items: center;
          color: #1a1815;
          background:
            radial-gradient(circle at 25% 25%, rgba(168, 58, 44, .07), transparent 28%),
            radial-gradient(circle at 78% 72%, rgba(45, 74, 124, .08), transparent 30%),
            #f5f1e8;
          font-family: Arial, Helvetica, sans-serif;
        }
        main {
          width: 880px;
          padding: 46px 54px 50px;
          border-top: 1px solid rgba(26, 24, 21, .16);
          border-bottom: 1px solid rgba(26, 24, 21, .16);
          text-align: center;
        }
        .eyebrow {
          color: #a83a2c;
          font-size: 15px;
          font-weight: 800;
          letter-spacing: .2em;
          text-transform: uppercase;
        }
        h1 {
          margin: 19px 0 18px;
          font-family: Georgia, "Times New Roman", serif;
          font-size: 52px;
          font-weight: 400;
          letter-spacing: -.025em;
        }
        p {
          margin: 0 auto;
          max-width: 690px;
          color: #5c5851;
          font-size: 21px;
          line-height: 1.55;
        }
        strong { color: #2d4a7c; }
      </style>
    </head>
    <body>
      <main>
        <div class="eyebrow">Loom is</div>
        <h1>A local-first AI memory system.</h1>
        <p>
          Plain Markdown. A visual knowledge graph.
          <strong>Agents that organize, link, and verify.</strong>
        </p>
      </main>
    </body>
  </html>
`);
await page.screenshot({
  path: path.join(outputDirectory, "00-intro.png"),
});

await browser.close();
console.log(outputDirectory);
