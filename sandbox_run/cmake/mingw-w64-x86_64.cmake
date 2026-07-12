# Cross toolchain: Linux host -> x86_64 Windows target via MinGW-w64.
# Usage: cmake -S sandbox_run -B sandbox_run/build-win \
#          -DCMAKE_TOOLCHAIN_FILE=cmake/mingw-w64-x86_64.cmake
# Builds sandbox_run.exe for compile-checking on the Linux dev box; behavioral
# verification still requires real Windows (see WINDOWS_PHASE.md WP-CI).

set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR x86_64)

# Ubuntu's package installs x86_64-w64-mingw32-g++ (alternatives symlink) or
# only the -posix/-win32 suffixed binaries when extracted without dpkg.
find_program(MINGW_CXX NAMES x86_64-w64-mingw32-g++ x86_64-w64-mingw32-g++-posix REQUIRED)
find_program(MINGW_CC NAMES x86_64-w64-mingw32-gcc x86_64-w64-mingw32-gcc-posix REQUIRED)
set(CMAKE_CXX_COMPILER ${MINGW_CXX})
set(CMAKE_C_COMPILER ${MINGW_CC})

set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
