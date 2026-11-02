/**
 * src/config/sampleProjects.ts
 *
 * Built-in sample Ren'Py projects for 1-click exploratory loading.
 * Provides "The Question" (Ren'Py's classic tutorial story) with full
 * character dialogue, branch choices, music, and terminal endings.
 */

import type { UploadedFile } from "../application/index.ts";

export const THE_QUESTION_SCRIPT = `
# The Question - Official Ren'Py Tutorial Game Sample Script
define s = Character("Sylvie", color="#c8ffc8")
define m = Character("Me", color="#c8c8ff")

label start:
    scene bg meadow
    play music "illurock.opus"

    "It's only when I hear the sounds of toiling elves that I realize where I am."
    "I am sitting on the grass, looking out over the meadow."

    show sylvie green normal
    with dissolve

    s "Hi there! How was class today?"

    m "It was alright. A lot of homework, though."

    s "You should take a break. Want to hear an idea I've been thinking about?"

    menu:
        "Sure, tell me about it!":
            jump tell_idea

        "Sorry, I need to study for finals.":
            jump study_alone

label tell_idea:
    s "I've been thinking of creating a visual novel!"
    s "It could have romance, comedy, maybe even some mystery."

    m "That sounds ambitious. Do you know how to program it?"

    s "I was hoping you could help me write the script and flowchart the routes."

    menu:
        "I'd love to help!":
            jump collaborative_ending

        "It sounds like too much work.":
            jump decline_project

label study_alone:
    scene bg bedroom
    "I spent the whole afternoon studying at my desk."
    "My exam scores were great, but I couldn't stop thinking about what Sylvie wanted to say."
    jump bad_ending_lonely

label collaborative_ending:
    scene bg clubroom
    play music "happy_ending.opus"
    "We spent the next three months writing scripts, drawing backgrounds, and testing menus."
    "The game was a huge success at the school festival!"
    s "We did it together! Best team ever!"
    return

label decline_project:
    scene bg hallway
    s "Oh... I understand. Maybe some other time."
    "She walked away disappointed. I never found out what kind of story she had in mind."
    jump bad_ending_lonely

label bad_ending_lonely:
    "Some opportunities only come around once in a lifetime."
    "End of Route."
    return
`.trim();

/**
 * Returns an UploadedFile array representing "The Question" sample project.
 */
export function getTheQuestionSampleFiles(): UploadedFile[] {
  return [
    {
      name: "script.rpy",
      webkitRelativePath: "the_question/script.rpy",
      size: THE_QUESTION_SCRIPT.length,
      text: () => Promise.resolve(THE_QUESTION_SCRIPT),
    },
  ];
}
