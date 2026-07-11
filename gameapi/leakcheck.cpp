// leakcheck.cpp (§11.6) — the Leak-monster shim. Linked ONLY into memory-zone
// lessons (via the lesson's extra_units field). Replaces global operator
// new/delete with counting wrappers; at exit it emits
//   {"type":"alloc_report","allocs":N,"frees":M,"live_bytes":B}
// on the @@EV@@ event channel. No ASan, no Valgrind — just this shim.
//
// std internals and statics allocate too, so counting is gated: the harness
// calls leakcheck_arm() / leakcheck_disarm() around the player-code section,
// and only allocations made while armed are tracked (a magic word in each
// block's header marks tracked blocks, so a tracked block freed after
// disarming still counts as freed).

#include <cstdio>
#include <cstdlib>
#include <new>

namespace {

// 16 bytes preserves max_align_t alignment on this target (aarch64).
struct Header {
    size_t size;
    size_t magic;
};
constexpr size_t HDR = 16;
constexpr size_t MAGIC = 0x4c45414b43484b21ULL;  // "LEAKCHK!"

bool g_armed = false;
bool g_atexit_registered = false;
long long g_allocs = 0;
long long g_frees = 0;
long long g_live_bytes = 0;

void report_at_exit() {
    // printf, not iostream: cout may already be torn down during atexit.
    std::printf(
        "@@EV@@ {\"v\":1,\"type\":\"alloc_report\",\"allocs\":%lld,\"frees\":%lld,\"live_bytes\":%lld}\n",
        g_allocs, g_frees, g_live_bytes);
    std::fflush(stdout);
}

void* counted_alloc(size_t size) {
    void* raw = std::malloc(size + HDR);
    if (!raw) throw std::bad_alloc();
    Header* h = static_cast<Header*>(raw);
    h->size = size;
    if (g_armed) {
        h->magic = MAGIC;
        ++g_allocs;
        g_live_bytes += static_cast<long long>(size);
    } else {
        h->magic = 0;
    }
    return static_cast<char*>(raw) + HDR;
}

void counted_free(void* ptr) {
    if (!ptr) return;
    Header* h = reinterpret_cast<Header*>(static_cast<char*>(ptr) - HDR);
    if (h->magic == MAGIC) {
        h->magic = 0;
        ++g_frees;
        g_live_bytes -= static_cast<long long>(h->size);
    }
    std::free(h);
}

}  // namespace

// Harness-facing controls (declared extern in crypt harnesses).
void leakcheck_arm() {
    if (!g_atexit_registered) {
        std::atexit(report_at_exit);
        g_atexit_registered = true;
    }
    g_armed = true;
}

void leakcheck_disarm() {
    g_armed = false;
}

long long leakcheck_allocs() { return g_allocs; }
long long leakcheck_frees() { return g_frees; }
long long leakcheck_live_bytes() { return g_live_bytes; }

// Global replacements. All forms funnel through the two counters above.
void* operator new(size_t size) { return counted_alloc(size); }
void* operator new[](size_t size) { return counted_alloc(size); }
void* operator new(size_t size, const std::nothrow_t&) noexcept {
    try { return counted_alloc(size); } catch (...) { return nullptr; }
}
void* operator new[](size_t size, const std::nothrow_t&) noexcept {
    try { return counted_alloc(size); } catch (...) { return nullptr; }
}

void operator delete(void* ptr) noexcept { counted_free(ptr); }
void operator delete[](void* ptr) noexcept { counted_free(ptr); }
void operator delete(void* ptr, size_t) noexcept { counted_free(ptr); }
void operator delete[](void* ptr, size_t) noexcept { counted_free(ptr); }
void operator delete(void* ptr, const std::nothrow_t&) noexcept { counted_free(ptr); }
void operator delete[](void* ptr, const std::nothrow_t&) noexcept { counted_free(ptr); }
