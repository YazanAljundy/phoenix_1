// A faithful stand-in for what a Mongoose model method actually returns.
//
// Model.findById()/find()/findOne() do not return a promise - they return a
// Query, which is thenable *and* chainable (.select(), .lean(), .sort(),
// .limit(), .populate(), .exec()). Stubbing them as `async () => value` models
// only the thenable half, so any production code that chains a builder method
// - which is ordinary, correct Mongoose usage - blows up inside the double
// rather than in the code under test.
//
// This wraps a plain resolver into something with both halves, so the stubs
// stay accurate as the queries they stand for evolve.
//
//   stubModule('models/user.model.js', {
//     findById: modelQuery((id) => users.get(String(id)) ?? null),
//   });

const CHAINABLE = ['select', 'lean', 'sort', 'limit', 'skip', 'populate', 'where', 'setOptions'];

function modelQuery(resolver) {
  return (...args) => {
    // Deferred: the resolver runs when the query is awaited/exec'd, matching
    // Mongoose, where building a query executes nothing.
    const run = () => Promise.resolve().then(() => resolver(...args));

    const query = {
      then: (onFulfilled, onRejected) => run().then(onFulfilled, onRejected),
      catch: (onRejected) => run().catch(onRejected),
      finally: (onFinally) => run().finally(onFinally),
      exec: () => run(),
    };
    for (const method of CHAINABLE) {
      query[method] = () => query;
    }
    return query;
  };
}

module.exports = { modelQuery };
