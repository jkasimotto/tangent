# Work Sessions

A WorkSession is a bounded unit of work attached to one entity. One entity may have multiple historical sessions and one active session by default.

Sessions can exist without agents. Agent starts normally create or attach to a session. Checkpoints transition sessions to paused, done, blocked, or abandoned.
