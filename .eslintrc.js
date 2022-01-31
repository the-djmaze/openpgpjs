module.exports = {
	parser: 'babel-eslint',
//	extends: ['eslint:recommended', 'plugin:prettier/recommended'],
	extends: ['eslint:recommended'],
	parserOptions: {
		ecmaVersion: 6,
		sourceType: 'module'
	},
	env: {
		node: true,
		browser: true,
		es2020: true
	},
	globals: {
		'globalThis': "readonly"
	},
	// http://eslint.org/docs/rules/
	rules: {
		// plugins
		'no-mixed-spaces-and-tabs': 'off',
		'max-len': [
			'error',
			300,
			2,
			{
				ignoreComments: true,
				ignoreUrls: true,
				ignoreTrailingComments: true,
				ignorePattern: '(^\\s*(const|let|var)\\s.+=\\s*require\\s*\\(|^import\\s.+\\sfrom\\s.+;$)'
			}
		],
		"no-empty": [
			"error",
			{
				"allowEmptyCatch": true
			}
		]
	}
};
