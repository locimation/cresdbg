# features/sample.feature

Feature: Crestron Test Demo

    Background:
        Given a control processor at "10.10.10.2"
        And a username of "crestron"
        And a password of "crestron"

    Scenario: Ain1
        Given "ain1" set to 1 for 50 ms
        Then "aout1" should be 1
        And "aout2" should be 0
        And "aout3" should be 0
        
    Scenario: Ain2
        Given "ain2" set to 1 for 50 ms
        Then "aout1" should be 0
        And "aout2" should be 1
        And "aout3" should be 0
        
    Scenario: Ain3
        Given "ain3" set to 1 for 50 ms
        Then "aout1" should be 0
        And "aout2" should be 0
        And "aout3" should be 1

    Scenario: SIO In 1
        Given "sin1" set to 1 for 50 ms
        Then "strout" should be "one"

    Scenario: SIO In 2
        Given "sin2" set to 1 for 50 ms
        Then "strout" should be "two"

    Scenario: SIO In 3
        Given "sin3" set to 1 for 50 ms
        Then "strout" should be "three"

    Scenario: SIO Out 1
        Given "strin" set to "one"
        Then "sout1" should be "1"

    Scenario: SIO Out 2
        Given "strin" set to "two"
        Then "sout2" should be "1"

    Scenario: SIO Out 3
        Given "strin" set to "three"
        Then "sout3" should be "1"