import { SecsMessage } from '../core/SecsMessage.js';
import {
  SecsItem,
  SecsList,
  SecsAscii,
  SecsBinary,
  SecsBoolean,
  SecsNumber,
} from '../core/secs2/SecsItem.js';
import { SecsItemType } from '../core/enums/SecsItemType.js';

class SmlCursor {
  constructor(
    public str: string,
    public pos = 0
  ) {}

  peek(): string {
    return this.str[this.pos];
  }

  consume(): string {
    return this.str[this.pos++];
  }

  eof(): boolean {
    return this.pos >= this.str.length;
  }

  skipWs() {
    while (!this.eof() && /\s/.test(this.peek())) this.pos++;
  }

  match(char: string): boolean {
    if (this.peek() === char) {
      this.consume();
      return true;
    }
    return false;
  }
}

export class SmlParser {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  private static readonly SML_REGEX = /^[Ss](\d+)[Ff](\d+)\s*(W?)\s*(.*)\.$/s;

  static parse(sml: string): SecsMessage {
    const trimmed = sml.trim();
    const match = this.SML_REGEX.exec(trimmed);

    if (!match) {
      throw new Error("Invalid SML format. Must match 'SxFy [W] <Body>.'");
    }

    const stream = parseInt(match[1], 10);
    const func = parseInt(match[2], 10);
    const wBit = match[3].toUpperCase() === 'W';
    const bodyStr = match[4].trim();

    let body: SecsItem | null = null;
    if (bodyStr.length > 0) {
      const cursor = new SmlCursor(bodyStr);
      body = this.parseItem(cursor);
    }

    return new SecsMessage(stream, func, wBit, body);
  }

  private static parseItem(cursor: SmlCursor): SecsItem {
    cursor.skipWs();
    if (cursor.consume() !== '<') {
      throw new Error(`Expected '<' at pos ${cursor.pos - 1}`);
    }

    cursor.skipWs();
    const typeStart = cursor.pos;
    while (!cursor.eof() && /[A-Z0-9]/.test(cursor.peek().toUpperCase())) {
      cursor.consume();
    }
    const typeStr = cursor.str.substring(typeStart, cursor.pos).toUpperCase();

    // Skip length [size]
    cursor.skipWs();
    if (cursor.peek() === '[') {
      while (!cursor.eof() && cursor.peek() !== ']') cursor.consume();
      if (cursor.peek() === ']') cursor.consume();
    }

    let item: SecsItem;

    if (typeStr === 'L') {
      const items: SecsItem[] = [];
      while (true) {
        cursor.skipWs();
        if (cursor.peek() === '>') {
          cursor.consume();
          break;
        } else if (cursor.peek() === '<') {
          items.push(this.parseItem(cursor));
        } else {
          throw new Error(`Unexpected char in List: '${cursor.peek()}' at ${cursor.pos}`);
        }
      }
      item = new SecsList(items);
    } else if (typeStr === 'A') {
      cursor.skipWs();
      // Expect quoted string
      if (cursor.peek() === '"') {
        cursor.consume();
        const start = cursor.pos;
        while (!cursor.eof() && cursor.peek() !== '"') cursor.consume(); // Handle escaping? SML usually simple.
        const val = cursor.str.substring(start, cursor.pos);
        cursor.consume(); // quote
        item = new SecsAscii(val);
      } else {
        // Empty string or unquoted? Standard says quoted.
        // Assuming empty if > follows immediately
        if (cursor.peek() === '>') {
            item = new SecsAscii('');
        } else {
             throw new Error(`Expected string value for type A at ${cursor.pos}`);
        }
      }
      cursor.skipWs();
      if (cursor.consume() !== '>') throw new Error("Expected '>' ending A");
    } else if (typeStr === 'B') {
      // Binary: 0xXX or XX
      const buffer: number[] = [];
      while (true) {
        cursor.skipWs();
        if (cursor.peek() === '>') {
          cursor.consume();
          break;
        }
        // Read byte
        // Handle 0x prefix
        if (cursor.str.startsWith('0x', cursor.pos) || cursor.str.startsWith('0X', cursor.pos)) {
            cursor.pos += 2;
        }
        const byteStr = cursor.str.substring(cursor.pos, cursor.pos + 2);
        const byteVal = parseInt(byteStr, 16);
        if (isNaN(byteVal)) throw new Error(`Invalid binary byte at ${cursor.pos}`);
        buffer.push(byteVal);
        cursor.pos += 2;
      }
      item = new SecsBinary(Buffer.from(buffer));
    } else if (typeStr === 'BOOLEAN') {
       const bools: boolean[] = [];
       while(true) {
           cursor.skipWs();
           if (cursor.peek() === '>') {
               cursor.consume();
               break;
           }
           // Read T/True/F/False
           const start = cursor.pos;
           while (!cursor.eof() && /[A-Z]/.test(cursor.peek().toUpperCase())) cursor.consume();
           const val = cursor.str.substring(start, cursor.pos).toUpperCase();
           if (['T', 'TRUE'].includes(val)) bools.push(true);
           else if (['F', 'FALSE'].includes(val)) bools.push(false);
           else throw new Error(`Invalid Boolean value ${val}`);
       }
       item = new SecsBoolean(bools.length === 1 ? bools[0] : bools);
    } else {
      // Numbers
      const nums: number[] = []; // or bigint
      // Simplified number parsing
      const isFloat = ['F4', 'F8'].includes(typeStr);
      
      while (true) {
        cursor.skipWs();
        if (cursor.peek() === '>') {
          cursor.consume();
          break;
        }
        const start = cursor.pos;
        while (!cursor.eof() && /[0-9.\-+]/.test(cursor.peek())) cursor.consume();
        const valStr = cursor.str.substring(start, cursor.pos);
        const val = isFloat ? parseFloat(valStr) : Number(valStr); // Use BigInt if needed for U8/I8
        if (isNaN(val)) throw new Error(`Invalid number ${valStr} at ${start}`);
        nums.push(val);
      }
      
      // Determine SecsItemType
      const type = SecsItemType[typeStr as keyof typeof SecsItemType];
      if (type === undefined) throw new Error(`Unknown type ${typeStr}`);

      item = new SecsNumber(type, nums.length === 1 ? nums[0] : nums);
    }

    return item;
  }
}
