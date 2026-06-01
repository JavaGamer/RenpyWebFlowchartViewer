label start:
    "before timer"
    screen timed_navigation():
        timer 5.0 action Jump("too_late")
        timer 3 action Call("helper")
        timer timeout_delay action Jump(dynamic_target)
        timer 7 action=If(can_skip, Jump("skip_target"), NullAction())
        timer 2 action If(can_call, [Call("helper_two")], NullAction())
        timer 6.5:
            action Jump("block_timeout_target")

label too_late:
    return

label helper:
    return

label skip_target:
    return

label helper_two:
    return

label block_timeout_target:
    return
