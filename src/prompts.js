import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export class ExitRequested extends Error {
  constructor() {
    super('用户请求退出');
    this.name = 'ExitRequested';
  }
}

function exitIfRequested(value) {
  if (['exit', 'quit'].includes(value.trim().toLowerCase())) throw new ExitRequested();
  return value;
}

export function matchListInput(inputValue, itemValues, commands) {
  const input = inputValue.trim().toLowerCase();
  if (/^\d+$/.test(input)) {
    const index = Number(input) - 1;
    if (index >= 0 && index < itemValues.length) return { value: itemValues[index] };
  }
  const command = commands.find((item) => (
    item.key.toLowerCase() === input
    || (item.aliases || []).some((alias) => alias.toLowerCase() === input)
  ));
  return command ? { value: command.value } : null;
}

export function commandIdentifier(command) {
  const aliases = command.aliases || [];
  return aliases.length ? `${command.key} (${aliases.join('/')})` : command.key;
}

export function createPrompter() {
  const rl = createInterface({ input, output });
  return {
    async text(label, defaultValue = '') {
      const suffix = defaultValue ? `（默认：${defaultValue}）` : '';
      const value = exitIfRequested(await rl.question(`${label}${suffix}：`)).trim();
      return value || defaultValue;
    },
    async confirm(label, defaultYes = false) {
      const answer = exitIfRequested(await rl.question(`${label} ${defaultYes ? '[Y/n]' : '[y/N]'}：`)).trim().toLowerCase();
      return answer ? ['y', 'yes', '是'].includes(answer) : defaultYes;
    },
    async select(label, choices) {
      if (!choices.length) throw new Error(`${label}：没有可选项`);
      while (true) {
        output.write(`${label}\n`);
        choices.forEach((choice, index) => output.write(`  ${index + 1}. ${choice.label}\n`));
        const answer = Number(exitIfRequested(await rl.question('请选择：')).trim());
        if (Number.isInteger(answer) && answer >= 1 && answer <= choices.length) return choices[answer - 1].value;
        output.write(`请输入 1-${choices.length}，或输入 exit 退出。\n`);
      }
    },
    async selectList(label, itemValues, commands) {
      if (!itemValues.length && !commands.length) throw new Error(`${label}：没有可选项`);
      output.write(`${label}\n`);
      const identifierWidth = Math.max(8, ...commands.map((command) => commandIdentifier(command).length));
      commands.forEach((command) => output.write(`  ${commandIdentifier(command).padEnd(identifierWidth)}  ${command.label}\n`));
      while (true) {
        const answer = exitIfRequested(await rl.question('请输入列表编号或操作标识：'));
        const matched = matchListInput(answer, itemValues, commands);
        if (matched) return matched.value;
        const range = itemValues.length ? `列表编号 1-${itemValues.length}` : '无可选列表项';
        const keys = commands.map((command) => commandIdentifier(command)).join(' / ');
        output.write(`请输入${range}${keys ? `，或 ${keys}` : ''}；输入 exit 退出。\n`);
      }
    },
    async pause(label = '按 Enter 返回') {
      exitIfRequested(await rl.question(`${label}…`));
    },
    close() {
      rl.close();
    },
  };
}
