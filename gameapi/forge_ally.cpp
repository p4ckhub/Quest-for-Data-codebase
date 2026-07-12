// forge_ally.cpp: hidden second scroll for allies-beyond-the-wall (Z2-H).
// Compiled as its own unit via extra_units; the player's scroll never sees
// this file. The player heralds `int rally();` and the linker binds the
// summons to this body at the end.
int rally() {
    return 14;
}
