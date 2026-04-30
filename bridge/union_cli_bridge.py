#!/usr/bin/env python3
"""union-cli Python JSON-RPC bridge.

Reads JSON-RPC requests from stdin, calls Python functions, writes results to stdout.
Protocol: one JSON object per line (newline-delimited JSON).
"""
import sys
import json
import importlib
import traceback


def handle_request(request):
    """Process a JSON-RPC request."""
    method = request.get('method')
    params = request.get('params', {})
    req_id = request.get('id')

    if method != 'call':
        return {
            'jsonrpc': '2.0',
            'error': {'code': -32601, 'message': f'Unknown method: {method}'},
            'id': req_id,
        }

    func_name = params.get('function')
    kwargs = params.get('kwargs', {})
    module_name = params.get('module')

    try:
        mod = importlib.import_module(module_name) if module_name else None
        if mod is None:
            return {
                'jsonrpc': '2.0',
                'error': {'code': -32602, 'message': 'No module specified'},
                'id': req_id,
            }

        func = getattr(mod, func_name, None)
        if func is None:
            return {
                'jsonrpc': '2.0',
                'error': {
                    'code': -32602,
                    'message': f'Function {func_name} not found in {module_name}',
                },
                'id': req_id,
            }

        result = func(**kwargs)
        return {'jsonrpc': '2.0', 'result': result, 'id': req_id}
    except Exception as e:
        return {
            'jsonrpc': '2.0',
            'error': {
                'code': -32000,
                'message': str(e),
                'data': traceback.format_exc(),
            },
            'id': req_id,
        }


def main():
    """Main loop: read requests from stdin, write responses to stdout."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            response = handle_request(request)
        except json.JSONDecodeError as e:
            response = {
                'jsonrpc': '2.0',
                'error': {'code': -32700, 'message': f'Parse error: {e}'},
                'id': None,
            }

        sys.stdout.write(json.dumps(response) + '\n')
        sys.stdout.flush()


if __name__ == '__main__':
    main()
