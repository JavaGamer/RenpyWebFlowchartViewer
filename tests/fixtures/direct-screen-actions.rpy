label start:
    "before screen"
    screen nav_overlay:
        textbutton "Jump A" action Jump("jump_target")
        textbutton "Call B" action Call("call_target")
        textbutton "Dynamic" action Jump(dynamic_target)

label jump_target:
    "arrived"

label call_target:
    "in call target"
    return
