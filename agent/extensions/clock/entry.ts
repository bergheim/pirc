export const CLOCK_TYPE = "clock";

export interface ClockData {
    t?: number;
    d?: number;
    /** In-flight run; renderer supplies live elapsed until settle. */
    live?: boolean;
}
