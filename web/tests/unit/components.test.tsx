import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { FireClock } from "@/components/charts/fire-clock";
import { RiskDial } from "@/components/charts/risk-dial";
import { DailyStrip } from "@/components/charts/daily-strip";
import { DriverList } from "@/components/region/drivers";
import { RiskBadge } from "@/components/ui/risk-badge";
import { Segmented } from "@/components/ui/segmented";
import az from "../../messages/az.json";
import en from "../../messages/en.json";

const wrap = (ui: React.ReactNode, locale: "az" | "en" = "en") =>
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "az" ? az : en} timeZone="Asia/Baku">
      {ui}
    </NextIntlClientProvider>,
  );

const years = [2021, 2022, 2023];
const matrix = years.map((_, y) => Array.from({ length: 52 }, (_, w) => (w > 25 && w < 34 ? 10 + y : 0)));

describe("FireClock", () => {
  it("draws one cell per year-week and an accessible table", () => {
    const { container } = wrap(<FireClock years={years} matrix={matrix} />);
    const cells = container.querySelectorAll("svg path[d^='M']");
    expect(cells.length).toBeGreaterThanOrEqual(3 * 52);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", expect.stringContaining("2021"));
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });
  it("shows the hovered cell value in the centre", () => {
    const { container } = wrap(<FireClock years={years} matrix={matrix} />);
    const svg = container.querySelector("svg")!;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 600, right: 600, bottom: 600, x: 0, y: 0, toJSON() {} });
    // a point in the outermost ring (2023) during week ~30 (late July → lower left of the clock)
    fireEvent.pointerMove(svg, { clientX: 140, clientY: 430 });
    expect(container.textContent).toMatch(/2023/);
  });
  it("calls onFocusYear when a ring is clicked", () => {
    const onFocus = vi.fn();
    const { container } = wrap(<FireClock years={years} matrix={matrix} onFocusYear={onFocus} />);
    const svg = container.querySelector("svg")!;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 600, right: 600, bottom: 600, x: 0, y: 0, toJSON() {} });
    fireEvent.pointerMove(svg, { clientX: 300, clientY: 52 });
    fireEvent.click(svg);
    expect(onFocus).toHaveBeenCalledWith(2023);
  });
});

describe("RiskDial", () => {
  it("labels the level in both languages", () => {
    const first = wrap(<RiskDial probability={0.71} level="very_high" />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", expect.stringContaining("Very high"));
    first.unmount();
    wrap(<RiskDial probability={0.71} level="very_high" />, "az");
    expect(screen.getAllByText("Çox yüksək").length).toBeGreaterThan(0);
  });
});

describe("Drivers", () => {
  it("turns SHAP drivers into plain sentences", () => {
    wrap(
      <DriverList
        drivers={[
          { code: "dry_spell", impact: 0.8, direction: "up", value: 12 },
          { code: "no_rain_ahead", impact: -0.4, direction: "down", value: 18.4 },
        ]}
      />,
    );
    expect(screen.getByText("No rain for 12 days")).toBeInTheDocument();
    expect(screen.getByText("Rain expected (18 mm)")).toBeInTheDocument();
  });
});

describe("DailyStrip", () => {
  it("renders seven days with temperatures", () => {
    const days = Array.from({ length: 8 }, (_, i) => ({ date: `2026-10-2${i}`.slice(0, 10), danger: i * 12, tmax: 20 + i, rh: 40, wind: 3, precip: i === 2 ? 5 : 0 }));
    const { container } = wrap(<DailyStrip days={days} />);
    expect(container.querySelectorAll("[title]")).toHaveLength(7);
    expect(screen.getByText("20°")).toBeInTheDocument();
  });
});

describe("UI primitives", () => {
  it("RiskBadge localises", () => {
    wrap(<RiskBadge level="extreme" />, "az");
    expect(screen.getByText("Ekstremal")).toBeInTheDocument();
  });
  it("Segmented is a keyboard-reachable radio group", () => {
    const onChange = vi.fn();
    wrap(<Segmented label="mode" value="a" onChange={onChange} options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />);
    expect(screen.getByRole("radiogroup", { name: "mode" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "A" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "B" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });
});
