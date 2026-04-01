label start:
    menu:
        "Ask about quest":
            menu:
                "Accept quest":
                    jump accepted
                "Decline quest":
                    jump declined
        "Leave":
            jump declined

label accepted:
    "Quest accepted"

label declined:
    "Quest declined"
