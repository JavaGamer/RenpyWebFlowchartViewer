label f1_label_0:
    "line 0 a"
    "line 0 b"
    menu:
        "Go next":
            jump f1_label_1
        "Call util":
            call f1_label_0_util

label f1_label_0_util:
    "utility"
    return

label f1_label_1:
    "line 1 a"
    "line 1 b"
    jump f1_label_2

label f1_label_1_util:
    "utility"
    return

label f1_label_2:
    "line 2 a"
    "line 2 b"
    jump f1_label_3

label f1_label_2_util:
    "utility"
    return

label f1_label_3:
    "line 3 a"
    "line 3 b"
    jump f1_label_4

label f1_label_3_util:
    "utility"
    return

label f1_label_4:
    "line 4 a"
    "line 4 b"
    menu:
        "Go next":
            jump f1_label_5
        "Call util":
            call f1_label_4_util

label f1_label_4_util:
    "utility"
    return

label f1_label_5:
    "line 5 a"
    "line 5 b"
    jump f1_label_6

label f1_label_5_util:
    "utility"
    return

label f1_label_6:
    "line 6 a"
    "line 6 b"
    jump f1_label_7

label f1_label_6_util:
    "utility"
    return

label f1_label_7:
    "line 7 a"
    "line 7 b"
    jump f1_label_8

label f1_label_7_util:
    "utility"
    return

label f1_label_8:
    "line 8 a"
    "line 8 b"
    menu:
        "Go next":
            jump f1_label_9
        "Call util":
            call f1_label_8_util

label f1_label_8_util:
    "utility"
    return

label f1_label_9:
    "line 9 a"
    "line 9 b"
    jump f1_label_10

label f1_label_9_util:
    "utility"
    return

label f1_label_10:
    "line 10 a"
    "line 10 b"
    jump f1_label_11

label f1_label_10_util:
    "utility"
    return

label f1_label_11:
    "line 11 a"
    "line 11 b"
    jump f1_label_0

label f1_label_11_util:
    "utility"
    return
