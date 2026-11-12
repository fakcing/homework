// Event-loop puzzles (README). Run one at a time: node scripts/puzzles.mjs <1-4>
const puzzles = {
  1() {
    async function a() {
      console.log("a1");
      await b();
      console.log("a2");
    }
    async function b() {
      console.log("b");
    }
    console.log("start");
    a();
    Promise.resolve().then(() => console.log("p"));
    console.log("end");
  },
  2() {
    setTimeout(() => console.log("T1"), 0);
    Promise.resolve()
      .then(() => {
        console.log("P1");
        setTimeout(() => console.log("T2"), 0);
      })
      .then(() => console.log("P2"));
    console.log("sync");
  },
  3() {
    async function f1() {
      return 1;
    }
    async function f2() {
      return Promise.resolve(2);
    }
    f2().then(() => console.log("f2"));
    f1().then(() => console.log("f1"));
    Promise.resolve()
      .then(() => console.log("x"))
      .then(() => console.log("y"))
      .then(() => console.log("z"))
      .then(() => console.log("w"));
  },
  4() {
    Promise.reject(new Error("boom"))
      .then(() => console.log("then-1"))
      .catch(() => console.log("catch"))
      .finally(() => console.log("finally"))
      .then(() => console.log("then-2"));
    queueMicrotask(() => console.log("qm"));
    console.log("sync");
  },
};
puzzles[process.argv[2]]();
