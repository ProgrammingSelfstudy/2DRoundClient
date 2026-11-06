"""Minimal schema-less FlatBuffers reader: enough to walk a Cocos Studio .csb."""
import struct


class Buf:
    def __init__(self, b):
        self.b = b

    def u32(self, o): return struct.unpack_from("<I", self.b, o)[0]
    def i32(self, o): return struct.unpack_from("<i", self.b, o)[0]
    def u16(self, o): return struct.unpack_from("<H", self.b, o)[0]
    def f32(self, o): return struct.unpack_from("<f", self.b, o)[0]
    def root(self): return self.u32(0)

    def slots(self, t):
        """Number of vtable slots of the table at t."""
        v = t - self.i32(t)
        return (self.u16(v) - 4) // 2

    def field(self, t, i):
        """Absolute offset of slot i of table t, or None when absent."""
        v = t - self.i32(t)
        if 4 + 2 * i >= self.u16(v):
            return None
        off = self.u16(v + 4 + 2 * i)
        return t + off if off else None

    def table(self, o):  # an offset field points to a table
        return o + self.u32(o)

    def string(self, o):
        s = o + self.u32(o)
        n = self.u32(s)
        return self.b[s + 4:s + 4 + n].decode("utf-8", "replace")

    def vec(self, o):
        s = o + self.u32(o)
        return s + 4, self.u32(s)
