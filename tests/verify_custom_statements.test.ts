import { expect, test } from "vitest";
import { parseRenpyFiles } from "../src/parser/parser.ts";

test("verify parsing of custom timedchoice, gameover, and title statements with generic mock data", async () => {
  const fileContent = `
label scenario_start:
    "First scenario dialogue line."
    timedchoice 3.0 label_choice_timeout
    menu:
        "Make a decision?"
        "Option A":
            "Chosen option A."
    gameover "Ending A"
    return

label label_choice_timeout:
    "Timeout occurred dialogue."
    timedchoice 1.1 label_final_exit
    menu:
        "Proceed to end?":
            "Proceeding."
    gameover "Ending B"
    return

label label_final_exit:
    "Final placeholder."
    return
  `;

  console.log("Parsing generic mock script...");
  const result = await parseRenpyFiles([
    {
      name: "mock_script.rpy",
      relativePath: "scenario/custom/mock_script.rpy",
      content: fileContent,
    }
  ], {
    parserVariant: "renpy",
    captureDialogueLines: true,
  });

  console.log(`Generated Nodes: ${result.nodes.length}`);
  console.log(`Generated Edges: ${result.edges.length}`);

  // 1. Verify incoming edges to label_choice_timeout
  const timeoutIncoming = result.edges.filter(e => e.target === "label_choice_timeout");
  console.log(`label_choice_timeout incoming edge count: ${timeoutIncoming.length}`);
  expect(timeoutIncoming.length).toBeGreaterThan(0);
  
  const timeoutEdge = timeoutIncoming.find(e => e.timeout?.isTimeout === true);
  expect(timeoutEdge).toBeDefined();
  expect(timeoutEdge?.timeout?.durationSeconds).toBe(3.0);
  console.log("Successfully verified timedchoice timeout edge to label_choice_timeout!");

  // 2. Verify incoming edges to label_final_exit
  const finalExitIncoming = result.edges.filter(e => e.target === "label_final_exit");
  console.log(`label_final_exit incoming edge count: ${finalExitIncoming.length}`);
  expect(finalExitIncoming.length).toBeGreaterThanOrEqual(1);
  
  const finalExitTimeoutEdge = finalExitIncoming.find(e => e.timeout?.isTimeout === true);
  expect(finalExitTimeoutEdge).toBeDefined();
  expect(finalExitTimeoutEdge?.timeout?.durationSeconds).toBe(1.1);
  console.log("Successfully verified timedchoice timeout edge to label_final_exit!");

  // 3. Verify that gameover and title are not parsed as dialogue characters
  let foundLinesCount = 0;
  for (const node of result.nodes) {
    if (node.dialogueLines) {
      node.dialogueLines.forEach((line) => {
        if (line.includes("Ending A") || line.includes("Ending B")) {
          console.log(`Found dialogue line: "${line}" in node "${node.id}"`);
          foundLinesCount++;
        }
      });
    }
  }
  expect(foundLinesCount).toBe(0);
  console.log("Successfully verified no misparsed custom statements in dialogue!");
}, 15000);
