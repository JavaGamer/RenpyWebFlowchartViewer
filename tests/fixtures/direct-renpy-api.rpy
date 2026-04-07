label start:
    "before"
    python:
        renpy.jump("jump_target")
        renpy.call("call_target")
        renpy.call(dynamic_target)
        while state_flag:
            renpy.jump("loop_target")
    "after"

label next_label:
    "next"

label jump_target:
    "jumped"

label loop_target:
    "looped"

label call_target:
    "called"
    return
