const commands = require('./commands');
const rpc = require('./jsonrpc');

// ===----------------------------------------------------------------------===//
// JsonRPC
// ===----------------------------------------------------------------------===//
function Client (opts) {
  // @ts-ignore
  this.rpc = new rpc.JsonRPC(opts);
}

// ===----------------------------------------------------------------------===//
// cmd
// ===----------------------------------------------------------------------===//
Client.prototype.cmd = function () {
  const args = [].slice.call(arguments);
  const cmd = args.shift();

  callRpc(cmd, args, this.rpc);
};

// ===----------------------------------------------------------------------===//
// callRpc
// ===----------------------------------------------------------------------===//
function callRpc (cmd, args, rpc) {
  let fn = args[args.length - 1];

  // If the last argument is a callback, pop it from the args list
  if (typeof fn === 'function') {
    args.pop();
  } else {
    fn = function () {};
  }

  return rpc.call(cmd, args, function () {
    const args = [].slice.call(arguments);
      // @ts-ignore
    args.unshift(null);
      // @ts-ignore
    fn.apply(this, args);
  }, function (err) {
    fn(err);
  });
}

// ===----------------------------------------------------------------------===//
// Initialize wrappers
// ===----------------------------------------------------------------------===//
(function () {
  for (const protoFn in commands) {
    (function (protoFn) {
      Client.prototype[protoFn] = function () {
        const args = [].slice.call(arguments);
        return callRpc(commands[protoFn], args, this.rpc);
      };
    })(protoFn);
  }
})();

// Chains Explorer: any RPC by name, as a promise (the chain modules call their chain's own RPCs with it)
Client.prototype.call = function (method, ...params) {
  return this.rpc.call(method, params);
};

// Export!
module.exports.Client = Client;
