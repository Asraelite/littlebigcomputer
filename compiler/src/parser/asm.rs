use nom::{
	branch::alt,
	bytes::complete::tag,
	character::complete::{alphanumeric1, char, one_of},
	combinator::{map, map_res, recognize},
	multi::{many0, many1, separated_list0},
	sequence::{preceded, terminated, tuple},
	IResult,
};

pub enum Instruction {
	Add(Operand, Operand, Operand),
	Sub(Operand, Operand, Operand),
	Beqz(Operand, Operand),
}

pub enum Operand {
	Direct(u8),
	Identifier(String),
}
