export type RollupPeriod =
  | {
      kind: "day";
      date: string;
      startDate: string;
      endDate: string;
      key: string;
      label: string;
    }
  | {
      kind: "range";
      startDate: string;
      endDate: string;
      key: string;
      label: string;
    };
