use crate::{
	parser::{Expression, Statement},
	CompilationError,
};

struct Context {
	temporary_counter: usize,
}

impl Context {
	fn new() -> Self {
		Self {
			temporary_counter: 0,
		}
	}

	fn new_temporary(&mut self) -> String {
		let result = format!("__temp{}", self.temporary_counter);
		self.temporary_counter += 1;
		result
	}
}

pub fn compile(ast: Statement) -> Result<String, CompilationError> {
	let mut context = Context::new();
	println!("initial: {:#?}\n", ast);
	let ast = ast_pass_0(ast)?;
	println!("pass 0: {:#?}\n", ast);
	let ast = ast_pass_1(&mut context, vec![ast])?;
	println!("pass 1: {:#?}\n", ast);
	Ok(format!("{:?}\n", ast))
}

/// Pass 0
///
/// Rewrites compound assignments into simple assignments, e.g. `a += 1` to `a = a + 1`
fn ast_pass_0(ast: Statement) -> Result<Statement, CompilationError> {
	let result = match ast {
		Statement::Block(inner) => Statement::Block(
			inner
				.into_iter()
				.map(ast_pass_0)
				.collect::<Result<Vec<_>, _>>()?,
		),
		Statement::AddAssign(name, expr) => Statement::Assign(
			name.clone(),
			Expression::Add(Box::new(Expression::Identifier(name)), Box::new(expr)),
		),
		statement => statement,
	};
	Ok(result)
}

/// Pass 1
///
/// Expands nested expressions into simple expressions,
/// e.g. `a = (x + y) + z;` to `temp0 = x + y; a = temp0 + z;`
fn ast_pass_1(
	context: &mut Context,
	statements: Vec<Statement>,
) -> Result<Vec<Statement>, CompilationError> {
	let mut statements_out = Vec::new();

	for statement in statements {
		match statement {
			Statement::Block(inner) => {
				statements_out.push(Statement::Block(ast_pass_1(context, inner)?));
			}
			Statement::Assign(name, expr) => {
				let (mut expression_statements, expression) =
					flatten_expression(context, expr.clone())?;

				statements_out.extend(expression_statements);
				statements_out.push(Statement::Assign(name.clone(), expression));
			}
			statement => statements_out.push(statement),
		};
	}
	Ok(statements_out)
}

fn flatten_expression(
	context: &mut Context,
	expression: Expression,
) -> Result<(Vec<Statement>, Expression), CompilationError> {
	let mut statements = Vec::new();

	let result = match expression {
		Expression::Identifier(name) => (vec![], Expression::Identifier(name)),
		Expression::Number(name) => (vec![], Expression::Number(name)),
		Expression::Add(left, right) => {
			let (left_statements, left) = flatten_expression(context, *left)?;
			statements.extend(left_statements);

			let (right_statements, right) = flatten_expression(context, *right)?;
			statements.extend(right_statements);

			let temp_name = context.new_temporary();

			let statement = Statement::Assign(
				temp_name.clone(),
				Expression::Add(Box::new(left), Box::new(right)),
			);
			statements.push(statement);
			(statements, Expression::Identifier(temp_name))
		}
		expression => (vec![], expression),
	};
	Ok(result)
}

/// Pass 2
///
/// Convert to IR
fn ast_pass_2(
	context: &mut Context,
	statements: Vec<Statement>,
) -> Result<Vec<Statement>, CompilationError> {
	let mut statements_out = Vec::new();

	for statement in statements {
		match statement {
			Statement::Block(inner) => {
				statements_out.push(Statement::Block(ast_pass_1(context, inner)?));
			}
			Statement::Assign(name, expr) => {
				let (mut expression_statements, expression) =
					flatten_expression(context, expr.clone())?;

				statements_out.extend(expression_statements);
				statements_out.push(Statement::Assign(name.clone(), expression));
			}
			statement => statements_out.push(statement),
		};
	}
	Ok(statements_out)
}
