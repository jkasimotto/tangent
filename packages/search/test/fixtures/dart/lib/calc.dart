library fixture.calc;

int addValues(int left, int right) {
  return left + right;
}

class Calculator {
  int add(int left, int right) {
    return addValues(left, right);
  }
}

class HistoryEntry {
  final int total;
  HistoryEntry(this.total);
}

class CalcToolState {
  final Calculator calculator;
  final List<HistoryEntry> history = [];
  static final HistoryEntry emptyEntry = HistoryEntry(0);

  CalcToolState(
      Calculator sharedCalculator,
      HistoryEntry seedEntry,
      this.calculator)
      : assert(seedEntry.total >= 0);

  int get lastTotal => latestEntry(history).total;

  void record(
      int left,
      int right) {
    history.add(HistoryEntry(calculator.add(left, right)));
  }
}

class ReplayToolState {
  final CalcToolState _inner;
  ReplayToolState(this._inner);

  void replayAll() {
    _inner.record(1, 2);
  }
}

enum CalcMode {
  standard,
  scientific(10),
}

HistoryEntry latestEntry(List<HistoryEntry> entries) {
  return entries.last;
}
