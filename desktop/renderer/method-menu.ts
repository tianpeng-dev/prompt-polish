import { THINKING_METHODS } from "../../src/thinking-methods.js";

export class MethodMenu {
  private readonly options: HTMLButtonElement[] = [];
  private failed = false;
  constructor(
    private readonly root: HTMLElement,
    private readonly description: HTMLElement,
    copy: (id: string) => void,
  ) {
    for (const method of THINKING_METHODS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "method-option";
      button.dataset.method = method.id;
      button.setAttribute("role", "menuitem");
      button.setAttribute("aria-label", `使用${method.name}并复制提示词`);
      button.setAttribute("aria-describedby", description.id);
      button.title = `${method.name}：${method.description}`;
      button.tabIndex = this.options.length === 0 ? 0 : -1;
      const label = document.createElement("span");
      label.textContent = method.name;
      const icon = document.createElement("span");
      icon.className = "icon icon--copy";
      icon.setAttribute("aria-hidden", "true");
      button.append(label, icon);
      button.addEventListener("click", () => copy(method.id));
      button.addEventListener("pointerenter", () =>
        this.describe(method.description),
      );
      button.addEventListener("focus", () => {
        for (const option of this.options)
          option.tabIndex = option === button ? 0 : -1;
        this.describe(method.description);
      });
      this.options.push(button);
      root.append(button);
    }
    root.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      const index = this.options.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      if (index < 0) return;
      let next: number | null = null;
      if (event.key === "ArrowDown") next = (index + 2) % this.options.length;
      if (event.key === "ArrowUp")
        next = (index - 2 + this.options.length) % this.options.length;
      if (event.key === "ArrowRight") next = (index + 1) % this.options.length;
      if (event.key === "ArrowLeft")
        next = (index - 1 + this.options.length) % this.options.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = this.options.length - 1;
      if (next !== null) {
        event.preventDefault();
        this.options[next]!.focus();
        this.options[next]!.scrollIntoView?.({ block: "nearest" });
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.options[index]!.click();
      }
    });
  }

  private describe(message: string) {
    if (!this.failed) this.message(message);
  }

  message(message: string, tone = "neutral") {
    this.failed = tone === "error";
    this.description.textContent = message;
    this.description.title = message;
    this.description.dataset.tone = tone;
  }

  setBusy(busy: boolean) {
    this.root.setAttribute("aria-busy", String(busy));
    for (const option of this.options) option.disabled = busy;
  }

  focusFirst() {
    this.failed = false;
    this.options[0]!.focus();
  }
}
