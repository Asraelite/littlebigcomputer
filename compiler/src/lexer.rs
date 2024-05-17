use crate::CompilationError;

#[derive(Debug, Clone)]
pub enum Token {
	Identifier(String),
	Character(char),
	Number(i32),
	Operator(Operator),
	Colon,
	AtSign,
	OpenParenthesis,
	CloseParenthesis,
	OpenBrace,
	CloseBrace,
	Assignment(Assignment),
	Comparison(Comparison),
	Semicolon,
	Keyword(Keyword),
}

#[derive(Debug, Copy, Clone)]
pub enum Operator {
	Plus,
	Minus,
	Star,
	Slash,
}

#[derive(Debug, Copy, Clone)]
pub enum Keyword {
	Let,
	Return,
}

#[derive(Debug, Copy, Clone)]
pub enum Assignment {
	Assign,
	AddAssign,
}

#[derive(Debug, Copy, Clone)]
pub enum Comparison {
	Equals,
	GreaterThan,
	LessThan,
}

#[derive(Debug, Clone)]
pub struct LexerConfiguration {}

struct Lexer {
	configuration: LexerConfiguration,
	input: Vec<char>,
	position: usize,
	line: usize,
	line_start_position: usize,
}

impl Lexer {
	fn new(configuration: LexerConfiguration, input: &str) -> Self {
		Self {
			configuration: LexerConfiguration {},
			input: input.chars().collect(),
			position: 0,
			line: 0,
			line_start_position: 0,
		}
	}

	fn next_token(&mut self) -> Result<Option<Token>, CompilationError> {
		while self.position < self.input.len() {
			let next = &self.input[self.position..];
			self.position += 1;

			type Tk = Token;

			let token = match next {
				['=', '=', ..] => Tk::Comparison(Comparison::Equals),
				['>', ..] => Tk::Comparison(Comparison::GreaterThan),
				['<', ..] => Tk::Comparison(Comparison::LessThan),
				['=', ..] => Tk::Assignment(Assignment::Assign),
				['+', '=', ..] => Tk::Assignment(Assignment::AddAssign),
				['+', ..] => Tk::Operator(Operator::Plus),
				['-', ..] => Tk::Operator(Operator::Minus),
				['*', ..] => Tk::Operator(Operator::Star),
				['/', ..] => Tk::Operator(Operator::Slash),
				['(', ..] => Tk::OpenParenthesis,
				[')', ..] => Tk::CloseParenthesis,
				['a'..='z' | 'A'..='Z' | '_', ..] => {
					let start = self.position - 1;
					while self.position < self.input.len()
						&& (self.input[self.position].is_alphanumeric()
							|| self.input[self.position] == '_')
					{
						self.position += 1;
					}
					let identifier = self.input[start..self.position].iter().collect::<String>();

					match identifier.as_str() {
						"let" => Token::Keyword(Keyword::Let),
						"return" => Token::Keyword(Keyword::Return),
						_ => Token::Identifier(identifier),
					}
				}
				['{', ..] => Tk::OpenBrace,
				['}', ..] => Tk::CloseBrace,
				[';', ..] => Tk::Semicolon,
				[':', ..] => Tk::Colon,
				['@', ..] => Tk::AtSign,
				['\'', ..] => {
					let start = self.position;
					while self.position < self.input.len() && self.input[self.position] != '\'' {
						self.position += 1;
					}
					if self.position >= self.input.len() {
						return Err(CompilationError {
							message: format!("Expected closing single quote"),
							line: self.line,
							column: start - self.line_start_position,
						});
					}
					self.position += 1;
					let character = self.input[start..self.position - 1]
						.iter()
						.collect::<String>()
						.chars()
						.next()
						.unwrap();
					Token::Character(character)
				}
				['0'..='9', ..] => {
					let start = self.position - 1;
					while self.position < self.input.len() && self.input[self.position].is_digit(10)
					{
						self.position += 1;
					}
					let number: i32 = self.input[start..self.position]
						.iter()
						.collect::<String>()
						.parse::<i32>()
						.map_err(|err| CompilationError {
							message: format!("Expected closing single quote"),
							line: self.line,
							column: start - self.line_start_position,
						})?;
					Token::Number(number)
				}

				['\n', ..] => {
					self.line += 1;
					self.line_start_position = self.position;
					continue;
				}
				[' ', '\t', ..] => continue,
				_ => continue,
			};
			return Ok(Some(token));
		}

		Ok(None)
	}
}

pub fn lex(input: &str, configuration: LexerConfiguration) -> Result<Vec<Token>, String> {
	let mut lexer = Lexer::new(configuration, input);
	let mut tokens = Vec::new();

	loop {
		let token = match lexer.next_token() {
			Ok(Some(token)) => token,
			Ok(None) => break,
			Err(CompilationError {
				message,
				line,
				column,
			}) => {
				return Err(format!(
					"Parsing failed at line {}:{}: {}",
					line + 1, column + 1, message
				));
			}
		};
		tokens.push(token);
	}
	Ok(tokens)
}
