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
    # Windows implementation - placeholder stub for now (contains main())
    add_executable(sandbox_run src/sandbox_win.cpp)
else()
    message(FATAL_ERROR "Unsupported platform")
endif()

set_target_properties(sandbox_run PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/../toolchain/bin
)
