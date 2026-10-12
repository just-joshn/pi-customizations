export async function promptAndSettle(send, settlements, command, deadlineMs = 120000) {
  const before = settlements();
  const accepted = await send(command);
  if (accepted?.disposition !== 'started') return accepted;
  const deadline = Date.now() + deadlineMs;
  while (settlements() <= before) {
    if (Date.now() >= deadline) throw new Error('RPC prompt did not settle');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return accepted;
}
