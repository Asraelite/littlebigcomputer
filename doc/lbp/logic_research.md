(when a gate has multiple inputs, unless specified otherwise, the speed applies to all of the inputs)


# General

For multiple inputs, dependencies are evaluated by the order they appear on the gate, top to bottom.


# Selector

Cycle input is slow. It does not evaluate its dependencies early.
Other inputs are fast and behave as normal gates.


# Microchip

(with one input and no outputs)
All inputs fast

The activate input is checked before and independently of the regular inputs.

Other inputs are then checked top-to-bottom

Activation before other, older gates? No

With inner microchips and no inputs/outputs -> tag propogration is instant [microchip_activation_0]


# Sequencer

(with one input and no outputs)
All inputs fast


# Sackbot trick

Converting analog to digital with a sackbot is instant. It can be done multiple times per frame and occurs during the same phase as logic gates.

A sackbot uses about 1/250th of a thermometer (~4000 units). It has 16 inputs that can be used (~250 thermometer units per analog-to-digital conversion).

The output can be on for two frames instead of the expected one.



# Physics

Activating a destroyer and a tag on an object in the same frame causes the tag sensor to not activate.


# Non-terminal components

Timer: fast
Counter: fast
Toggle: fast
Randomiser: fast
Wave generator: fast


# Terminal components

Emitter: slow
Tag: slow
Mover: slow
