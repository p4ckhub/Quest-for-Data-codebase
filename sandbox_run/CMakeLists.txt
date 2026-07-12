cmake_minimum_required(VERSION 3.20)
project(sandbox_run LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Add include directory for sandbox.h
include_directories(${CMAKE_SOURCE_DIR}/src)

# Platform-specific source files - only compile the platform-specific implementation file
# which includes its own main() and parse_args()
if(APPLE OR UNIX)
    # POSIX implementation (Linux, macOS) - contains main()
    add_executable(sandbox_run src/sandbox_posix.cpp)
    target_link_libraries(sandbox_run PRIVATE pthread)
elseif(WIN32)
    # Windows implementation (contains main())
    add_executable(sandbox_run src/sandbox_win.cpp)
    # Static runtime: a bare Windows install has no libgcc_s_seh-1.dll /
    # libstdc++-6.dll / libwinpthread-1.dll (MinGW links them dynamically by
    # default). Job Object/process/pipe APIs live in kernel32, linked by default.
    target_link_options(sandbox_run PRIVATE -static -static-libgcc -static-libstdc++)
else()
    message(FATAL_ERROR "Unsupported platform")
endif()

# Anchored to the source dir, not the build dir: the repo-root toolchain/bin
# is where the runner looks, no matter where -B put the build tree.
set_target_properties(sandbox_run PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_SOURCE_DIR}/../toolchain/bin
)
