"""Run a Lua file with PoB's own Windows Lua runtime, without changing Lua code."""
import ctypes
import os
from pathlib import Path
import sys


def main():
    if sys.platform != "win32" or len(sys.argv) < 3:
        raise SystemExit("Usage: python windows-lua.py <PoB runtime directory> <Lua script> [args...]")

    runtime = Path(sys.argv[1]).resolve()
    script = Path(sys.argv[2]).resolve()
    os.environ["PATH"] = str(runtime) + os.pathsep + os.environ.get("PATH", "")
    with os.add_dll_directory(str(runtime)):
        lua = ctypes.CDLL(str(runtime / "lua51.dll"))
        pointer = ctypes.c_void_p
        lua.luaL_newstate.restype = pointer
        lua.luaL_openlibs.argtypes = [pointer]
        lua.luaL_loadfile.argtypes = [pointer, ctypes.c_char_p]
        lua.luaL_loadfile.restype = ctypes.c_int
        lua.lua_pcall.argtypes = [pointer, ctypes.c_int, ctypes.c_int, ctypes.c_int]
        lua.lua_pcall.restype = ctypes.c_int
        lua.lua_tolstring.argtypes = [pointer, ctypes.c_int, pointer]
        lua.lua_tolstring.restype = ctypes.c_char_p
        lua.lua_createtable.argtypes = [pointer, ctypes.c_int, ctypes.c_int]
        lua.lua_pushstring.argtypes = [pointer, ctypes.c_char_p]
        lua.lua_rawseti.argtypes = [pointer, ctypes.c_int, ctypes.c_int]
        lua.lua_setfield.argtypes = [pointer, ctypes.c_int, ctypes.c_char_p]
        lua.lua_close.argtypes = [pointer]

        state = lua.luaL_newstate()
        if not state:
            raise SystemExit("PoB Lua runtime could not create a state")
        try:
            lua.luaL_openlibs(state)
            args = [str(script), *sys.argv[3:]]
            lua.lua_createtable(state, len(args), 0)
            for index, value in enumerate(args):
                lua.lua_pushstring(state, value.encode("utf-8"))
                lua.lua_rawseti(state, -2, index)
            lua.lua_setfield(state, -10002, b"arg")  # LUA_GLOBALSINDEX in Lua 5.1
            status = lua.luaL_loadfile(state, str(script).encode("utf-8"))
            if status == 0:
                status = lua.lua_pcall(state, 0, -1, 0)
            if status:
                message = lua.lua_tolstring(state, -1, None)
                raise SystemExit(message.decode("utf-8", errors="replace") if message else "Lua execution failed")
        finally:
            lua.lua_close(state)


if __name__ == "__main__":
    main()
