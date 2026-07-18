import { text, confirm } from '@clack/prompts';
import { existsSync } from 'node:fs';

async function main() {
  const newPath = await text({
    message: "Path:",
    initialValue: "C:\\Users\\test",
  });
  console.log("newPath is", typeof newPath);
  
  if (typeof newPath !== "string") return;

  const targetPath = newPath;
  console.log("Checking existsSync");
  if (existsSync(targetPath)) {
    console.log("exists");
  }
  
  console.log("Before confirm");
  const init = await confirm({ message: "Initialize?", initialValue: true });
  console.log("After confirm", init);
}
main();
