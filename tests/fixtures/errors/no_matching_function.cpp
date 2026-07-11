// Test: no matching function (overload mismatch - existing function, wrong args)
int add(int a) { return a; }
int add(double a, double b) { return (int)(a + b); }
int main() {
    add('c', 'd', 'e');  // Calling with 3 args - no matching overload
    return 0;
}
