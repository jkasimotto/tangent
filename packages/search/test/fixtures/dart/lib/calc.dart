library fixture.calc;

int addValues(int left, int right) {
  return left + right;
}

class Calculator {
  int add(int left, int right) {
    return addValues(left, right);
  }
}
