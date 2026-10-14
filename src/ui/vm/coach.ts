// The hint of the demo trip on the screen (version 1.3; `CoachBubble.svelte`): what it says and what its arrow points at.

export interface Coach {
  /** A CSS selector of the element of the window the arrow points at; `null`: a card in the middle of the window, no arrow. */
  target: string | null;
  title: string;
  text: string;
  /** What the hint waits for, said small under the text ('Ждём: станция выбрана'); absent when it waits for its button. */
  doing?: string;
  step: number;
  total: number;
  /** The label of the button that moves on; absent: the step moves on by the player's own action in the window. */
  button?: string;
}
