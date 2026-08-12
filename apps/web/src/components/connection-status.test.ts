import { describe, expect, it } from "vitest";
import { connectionMessage } from "./connection-status";

describe("connectionMessage", () => {
  it("tells an editor user not to close a tab with unsaved changes", () => {
    expect(connectionMessage("editor", "offline")).toContain("не закрывайте");
  });

  it("explains that an active export continues on the server while offline", () => {
    expect(connectionMessage("export", "offline")).toContain("продолжится на сервере");
  });

  it("makes the recovery action explicit after reconnecting", () => {
    expect(connectionMessage("editor", "reconnected")).toContain("Отправляем");
    expect(connectionMessage("export", "reconnected")).toContain("Обновляем");
  });
});
