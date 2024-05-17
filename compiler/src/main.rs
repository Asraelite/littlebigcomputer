#![allow(unused)]

/*

can only reorder instructions within a block
branch points delimit blocks

*/

use std::env;
use std::fs;
use std::io::{self, Read};

mod compiler;
mod parser;

#[derive(Debug)]
pub struct CompilationError {
	pub message: String,
	pub line: usize,
	pub column: usize,
}

impl CompilationError {
	pub fn new(message: String, line: usize, column: usize) -> Self {
		Self {
			message,
			line,
			column,
		}
	}
}

fn main() {
	let args: Vec<String> = env::args().collect();
	let input = if args.len() > 1 {
		if ((args[1] == "-s") || (args[1] == "--source") && args.len() > 2) {
			args[2].to_owned()
		} else {
			let filename = &args[1];
			if filename == "--" {
				let mut buffer = String::new();
				io::stdin()
					.read_to_string(&mut buffer)
					.expect("Failed to read from stdin");
				buffer
			} else {
				fs::read_to_string(filename).expect("Failed to read file")
			}
		}
	} else {
		panic!("Expected a filename or '--' as argument");
	};

	let parse_result = match parser::parse(&input) {
		Ok(expr) => expr,
		Err(err) => {
			eprintln!("Error: {:?}", err);
			std::process::exit(1);
		}
	};

	let compile_result = match compiler::compile(parse_result) {
		Ok(expr) => expr,
		Err(err) => {
			eprintln!("Error: {:?}", err);
			std::process::exit(1);
		}
	};
	println!("Compiled: {:?}", compile_result);
}
