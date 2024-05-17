pub struct Variable {
	name: String,
}

pub enum PseudoInstruction {
	Call(Variable),
	Return,
	Add(Variable, Variable, Variable),
	Sub(Variable, Variable, Variable),
	Li(Variable, i32),
}
