use crate::CompilationError;

mod asm;

use nom::{
	branch::alt,
	bytes::complete::{tag, take_while},
	character::complete::{alpha1, alphanumeric1, char, one_of},
	combinator::{all_consuming, complete, map, map_res, opt, recognize},
	error::{dbg_dmp, ParseError},
	multi::{many0, many1, separated_list0},
	sequence::{delimited, preceded, terminated, tuple},
	Finish, IResult,
};

#[derive(Debug, Clone)]
pub enum Statement {
	Block(Vec<Statement>),
	Label(String),
	Assign(String, Expression),
	AddAssign(String, Expression),
	SubAssign(String, Expression),
	MulAssign(String, Expression),
	DivAssign(String, Expression),
	FunctionDeclaration(String, Vec<String>, Box<Statement>),
	SubroutineDeclaration(String, Box<Statement>),
}

#[derive(Debug, Copy, Clone)]
pub enum BinOp {
	Add,
	Sub,
	Mul,
	Div,
	Sll,
	Srl,
	Sra,
	BitAnd,
	BitOr,
	BitXor,
	Index,
}

#[derive(Debug, Clone)]
pub enum Expression {
	Number(i64),
	Identifier(String),
	FunctionCall(String, Vec<Expression>),
	Add(Box<Expression>, Box<Expression>),
	Sub(Box<Expression>, Box<Expression>),
	Mul(Box<Expression>, Box<Expression>),
	Div(Box<Expression>, Box<Expression>),
	Sll(Box<Expression>, Box<Expression>),
	Srl(Box<Expression>, Box<Expression>),
	Sra(Box<Expression>, Box<Expression>),
	BitNeg(Box<Expression>, Box<Expression>),
	BitAnd(Box<Expression>, Box<Expression>),
	BitOr(Box<Expression>, Box<Expression>),
	BitXor(Box<Expression>, Box<Expression>),
	Deref(Box<Expression>),
	Index(Box<Expression>, Box<Expression>),
}

pub fn parse(input: &str) -> Result<Statement, CompilationError> {
	let parse_result = all_consuming(complete(program))(input).finish();
	let ast = match parse_result {
		Ok((_, ast)) => ast,
		Err(err) => {
			// let (line, column) = get_line_and_column(input);
			let (line, column) = (0, 0); // TODO
			return Err(CompilationError::new(
				format!("Failed to parse input: {:?}", err),
				line,
				column,
			));
		}
	};

	Ok(ast)
}

fn expression(input: &str) -> IResult<&str, Expression> {
	alt((
		map_res(
			tuple((
				primitive_expression,
				whitespace,
				tag("+"),
				whitespace,
				expression,
			)),
			|(left, _, _, _, right)| {
				Ok::<_, nom::error::Error<String>>(Expression::Add(Box::new(left), Box::new(right)))
			},
		),
		map_res(
			tuple((
				primitive_expression,
				whitespace,
				tag("-"),
				whitespace,
				expression,
			)),
			|(left, _, _, _, right)| {
				Ok::<_, nom::error::Error<String>>(Expression::Sub(Box::new(left), Box::new(right)))
			},
		),
		map_res(
			tuple((
				primitive_expression,
				whitespace,
				tag("*"),
				whitespace,
				expression,
			)),
			|(left, _, _, _, right)| {
				Ok::<_, nom::error::Error<String>>(Expression::Mul(Box::new(left), Box::new(right)))
			},
		),
		map_res(
			tuple((
				primitive_expression,
				whitespace,
				tag("/"),
				whitespace,
				expression,
			)),
			|(left, _, _, _, right)| {
				Ok::<_, nom::error::Error<String>>(Expression::Div(Box::new(left), Box::new(right)))
			},
		),
		map_res(
			tuple((
				primitive_expression,
				whitespace,
				tag("<<"),
				whitespace,
				expression,
			)),
			|(left, _, _, _, right)| {
				Ok::<_, nom::error::Error<String>>(Expression::Sll(Box::new(left), Box::new(right)))
			},
		),
		map_res(
			tuple((
				primitive_expression,
				whitespace,
				tag(">>"),
				whitespace,
				expression,
			)),
			|(left, _, _, _, right)| {
				Ok::<_, nom::error::Error<String>>(Expression::Srl(Box::new(left), Box::new(right)))
			},
		),
		map_res(
			tuple((
				primitive_expression,
				whitespace,
				tag("&"),
				whitespace,
				expression,
			)),
			|(left, _, _, _, right)| {
				Ok::<_, nom::error::Error<String>>(Expression::BitAnd(
					Box::new(left),
					Box::new(right),
				))
			},
		),
		map_res(
			tuple((
				primitive_expression,
				whitespace,
				tag("|"),
				whitespace,
				expression,
			)),
			|(left, _, _, _, right)| {
				Ok::<_, nom::error::Error<String>>(Expression::BitOr(
					Box::new(left),
					Box::new(right),
				))
			},
		),
		map_res(
			tuple((
				primitive_expression,
				whitespace,
				tag("^"),
				whitespace,
				expression,
			)),
			|(left, _, _, _, right)| {
				Ok::<_, nom::error::Error<String>>(Expression::BitXor(
					Box::new(left),
					Box::new(right),
				))
			},
		),
		map_res(
			tuple((
				identifier,
				whitespace,
				delimited(
					tag("("),
					separated_list0(tag(","), delimited(whitespace, expression, whitespace)),
					tag(")"),
				),
			)),
			|(name, _, arguments)| {
				Ok::<_, nom::error::Error<String>>(Expression::FunctionCall(
					name.to_string(),
					arguments,
				))
			},
		),
		map_res(
			tuple((
				tag("*"),
				whitespace,
				expression,
			)),
			|(_, _, value)| {
				Ok::<_, nom::error::Error<String>>(Expression::Deref(Box::new(value)))
			},
		),
		primitive_expression,
	))(input)
}

fn primitive_expression(input: &str) -> IResult<&str, Expression> {
	alt((
		variable,
		number,
		map_res(
			tuple((tag("("), whitespace, expression, whitespace, tag(")"))),
			|(_, _, expr, _, _)| Ok::<_, nom::error::Error<String>>(expr),
		),
	))(input)
}

fn statement(input: &str) -> IResult<&str, Statement> {
	delimited(whitespace, alt((block, assignment, function)), whitespace)(input)
}

fn block(input: &str) -> IResult<&str, Statement> {
	let (input, (_, _, statements, _, _)) =
		tuple((tag("{"), whitespace, many0(statement), whitespace, tag("}")))(input)?;
	Ok((input, Statement::Block(statements)))
}

fn program(input: &str) -> IResult<&str, Statement> {
	let (input, (statements)) = many0(statement)(input)?;
	Ok((input, Statement::Block(statements)))
}

fn assignment(input: &str) -> IResult<&str, Statement> {
	let (input, (name, _, operator, _, expr, _)) = tuple((
		identifier,
		whitespace,
		opt(one_of("+-/*")),
		tag("="),
		delimited(whitespace, expression, whitespace),
		tag(";"),
	))(input)?;
	let name = name.to_string();
	let statement = match operator {
		Some('+') => Statement::AddAssign(name, expr),
		Some('-') => Statement::SubAssign(name, expr),
		Some('/') => Statement::SubAssign(name, expr),
		Some('*') => Statement::SubAssign(name, expr),
		None => Statement::Assign(name, expr),
		_ => unreachable!(),
	};
	Ok((input, statement))
}

fn function(input: &str) -> IResult<&str, Statement> {
	let (input, (_, name, params, _, body)) = tuple((
		tag("fn"),
		delimited(whitespace, identifier, whitespace),
		delimited(tag("("), separated_list0(tag(","), identifier), tag(")")),
		whitespace,
		block,
	))(input)?;

	Ok((
		input,
		Statement::FunctionDeclaration(
			name.to_string(),
			params.into_iter().map(String::from).collect(),
			Box::new(body),
		),
	))
}

fn variable(input: &str) -> IResult<&str, Expression> {
	map(identifier, |name| Expression::Identifier(name.to_string()))(input)
}

fn identifier(input: &str) -> IResult<&str, &str> {
	recognize(tuple((alt((tag("_"), alpha1)), many0(alphanumeric1))))(input)
}

fn number(input: &str) -> IResult<&str, Expression> {
	let (input, number) = map(
		alt((
			hexadecimal_number,
			octal_number,
			binary_number,
			decimal_number,
		)),
		|number| Expression::Number(number),
	)(input)?;

	Ok((input, number))
}

fn hexadecimal_number(input: &str) -> IResult<&str, i64> {
	map_res(
		preceded(
			alt((tag("0x"), tag("0X"))),
			recognize(many1(terminated(
				one_of("0123456789abcdefABCDEF"),
				many0(char('_')),
			))),
		),
		|out: &str| i64::from_str_radix(&str::replace(&out, "_", ""), 16),
	)(input)
}

fn octal_number(input: &str) -> IResult<&str, i64> {
	map_res(
		preceded(
			alt((tag("0o"), tag("0O"))),
			recognize(many1(terminated(one_of("01234567"), many0(char('_'))))),
		),
		|out: &str| i64::from_str_radix(&str::replace(&out, "_", ""), 8),
	)(input)
}

fn binary_number(input: &str) -> IResult<&str, i64> {
	map_res(
		preceded(
			alt((tag("0b"), tag("0B"))),
			recognize(many1(terminated(one_of("01"), many0(char('_'))))),
		),
		|out: &str| i64::from_str_radix(&str::replace(&out, "_", ""), 2),
	)(input)
}

fn decimal_number(input: &str) -> IResult<&str, i64> {
	map_res(
		recognize(many1(terminated(one_of("0123456789"), many0(char('_'))))),
		|out: &str| i64::from_str_radix(&str::replace(&out, "_", ""), 10),
	)(input)
}

fn whitespace(i: &str) -> IResult<&str, &str> {
	recognize(many0(one_of(" \n\t")))(i)
}

// fn expect<'a, F, E, T>(parser: F, error_msg: E) -> impl Fn(&'a str) -> IResult<Option<T>, T>
// where
//     F: Fn(&'a str) -> IResult<T, T>,
//     E: ToString,
// {
//     move |input| match parser(input) {
//         Ok((remaining, out)) => Ok((remaining, Some(out))),
//         Err(nom::Err::Error((input, _))) | Err(nom::Err::Failure((input, _))) => {
//             let err = Error(input.to_range(), error_msg.to_string());
//             input.extra.report_error(err); // Push error onto stack.
//             Ok((input, None)) // Parsing failed, but keep going.
//         }
//         Err(err) => Err(err),
//     }
// }
