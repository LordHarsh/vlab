// Lightweight custom C++ (Arduino) and Python (RPi) line-by-line interpreter


export interface InterpreterLog {
  type: 'info' | 'error' | 'print';
  message: string;
}

export class CircuitInterpreter {
  public platform: 'Arduino' | 'Raspberry Pi' = 'Arduino';
  public code: string = '';
  
  // Scopes & state
  public globals: Record<string, any> = {};
  public locals: Record<string, any> = {};
  public pinModes: Record<string, 'INPUT' | 'OUTPUT' | 'INPUT_PULLUP'> = {};
  
  // Execution variables
  public pc: number = 0; // Program counter (index of parsedLines)
  public parsedLines: { text: string; originalLineNum: number }[] = [];
  public delayUntil: number = 0;
  public running: boolean = false;
  public paused: boolean = false;
  
  // Breakpoints (1-based line numbers matching Monaco Editor)
  public breakpoints: Set<number> = new Set();
  
  // Block tracking
  private isSetupDone: boolean = false;
  private isArduinoLooping: boolean = false;
  private loopStartPc: number = 0;
  private loopEndPc: number = 0;
  private setupStartPc: number = 0;
  private setupEndPc: number = 0;
  private whileStartPc: number = -1;
  private whileEndPc: number = -1;
  private lastIfResult: boolean = false;



  // Callbacks
  private onPinWrite: (pin: string, val: number | boolean) => void;
  private onPinRead: (pin: string) => any;
  private onSerialLog: (msg: string) => void;
  private onStateChange: () => void;

  constructor(
    onPinWrite: (pin: string, val: number | boolean) => void,
    onPinRead: (pin: string) => any,
    onSerialLog: (msg: string) => void,
    onStateChange: () => void
  ) {
    this.onPinWrite = onPinWrite;
    this.onPinRead = onPinRead;
    this.onSerialLog = onSerialLog;
    this.onStateChange = onStateChange;
  }

  public reset(platform: 'Arduino' | 'Raspberry Pi', code: string) {
    this.platform = platform;
    this.code = code;
    this.globals = {
      'HIGH': 1,
      'LOW': 0,
      'INPUT': 'INPUT',
      'OUTPUT': 'OUTPUT',
      'INPUT_PULLUP': 'INPUT_PULLUP',
      'True': true,
      'False': false,
      'Pin': { OUT: 'OUTPUT', IN: 'INPUT' }
    };
    this.locals = {};
    this.pinModes = {};
    this.pc = 0;
    this.delayUntil = 0;
    this.running = false;
    this.paused = false;
    this.isSetupDone = false;
    this.isArduinoLooping = false;
    this.whileStartPc = -1;
    this.whileEndPc = -1;
    this.lastIfResult = false;
    this.parsedLines = [];

    this.parseCode();
  }

  // Preprocesses and cleans code into lines that can be evaluated sequentially
  private parseCode() {
    const rawLines = this.code.split('\n');
    let inBlockComment = false;

    rawLines.forEach((rawLine, index) => {
      let line = rawLine.trim();
      const lineNum = index + 1; // 1-based index

      // Handle block comments
      if (inBlockComment) {
        if (line.includes('*/')) {
          inBlockComment = false;
          line = line.substring(line.indexOf('*/') + 2).trim();
        } else {
          return; // skip line
        }
      }

      if (line.startsWith('/*')) {
        inBlockComment = true;
        if (line.includes('*/')) {
          inBlockComment = false;
          line = line.substring(line.indexOf('*/') + 2).trim();
        } else {
          return;
        }
      }

      // Handle single-line comments
      if (line.startsWith('//') || line.startsWith('#')) {
        return; // Skip comments entirely
      }
      
      // Inline comments removal
      const doubleSlashIndex = line.indexOf('//');
      if (doubleSlashIndex !== -1) {
        line = line.substring(0, doubleSlashIndex).trim();
      }
      const hashIndex = line.indexOf('#');
      // For Python, allow # but check it is not in a string
      if (this.platform === 'Raspberry Pi' && hashIndex !== -1) {
        // Simple string check
        const firstQuote = line.indexOf('"');
        if (firstQuote === -1 || hashIndex < firstQuote) {
          line = line.substring(0, hashIndex).trim();
        }
      }

      if (line === '') return;

      this.parsedLines.push({ text: line, originalLineNum: lineNum });
    });

    if (this.platform === 'Arduino') {
      this.findArduinoBlocks();
    } else {
      this.findPythonBlocks();
    }
  }

  private findArduinoBlocks() {
    // Locate setup() and loop() braces
    let setupStart = -1;
    let setupEnd = -1;
    let loopStart = -1;
    let loopEnd = -1;

    let braceCount = 0;
    let inSetup = false;
    let inLoop = false;

    for (let i = 0; i < this.parsedLines.length; i++) {
      const line = this.parsedLines[i].text;

      if (line.includes('void setup()') || line.match(/void\s+setup\s*\(\s*\)/)) {
        inSetup = true;
        setupStart = i;
      } else if (line.includes('void loop()') || line.match(/void\s+loop\s*\(\s*\)/)) {
        inLoop = true;
        loopStart = i;
      }

      if (inSetup || inLoop) {
        // Count braces
        for (let ch of line) {
          if (ch === '{') braceCount++;
          if (ch === '}') {
            braceCount--;
            if (braceCount === 0) {
              if (inSetup) {
                setupEnd = i;
                inSetup = false;
              } else if (inLoop) {
                loopEnd = i;
                inLoop = false;
              }
            }
          }
        }
      }
    }

    this.setupStartPc = setupStart;
    this.setupEndPc = setupEnd;
    this.loopStartPc = loopStart;
    this.loopEndPc = loopEnd;

    // Start program counter at setup if it exists, otherwise at loop, otherwise 0
    if (this.setupStartPc !== -1) {
      this.pc = this.setupStartPc + 1; // start inside setup()
      this.isSetupDone = false;
    } else if (this.loopStartPc !== -1) {
      this.pc = this.loopStartPc + 1;
      this.isSetupDone = true;
      this.isArduinoLooping = true;
    } else {
      this.pc = 0;
    }
  }

  private findPythonBlocks() {
    this.pc = 0;
    this.whileStartPc = -1;
    this.whileEndPc = -1;

    for (let i = 0; i < this.parsedLines.length; i++) {
      const line = this.parsedLines[i].text.trim();
      if (line.startsWith('while ')) {
        this.whileStartPc = i;
        // Find the end of the while block by indentation
        const whileIndent = this.getIndentation(this.parsedLines[i].originalLineNum);
        let endPc = i;
        for (let j = i + 1; j < this.parsedLines.length; j++) {
          const indent = this.getIndentation(this.parsedLines[j].originalLineNum);
          if (indent > whileIndent) {
            endPc = j;
          } else {
            break;
          }
        }
        this.whileEndPc = endPc;
        break; // Track single while loop for simple scripts
      }
    }
  }

  // Safe evaluation of simple math & variable comparisons
  public evaluateExpression(expr: string): any {
    let resolvedExpr = expr.trim();

    // 0. Python & DHT Mocks
    // Support sensor.temperature() and sensor.humidity() for custom DHT variables
    if (resolvedExpr.includes('.temperature()') || resolvedExpr.includes('.humidity()')) {
      const pin = this.globals['dht_pin'] !== undefined ? this.globals['dht_pin'] : 4;
      const isConnected = this.onPinRead(String(pin)) === 999;
      if (!isConnected) {
        throw new Error(`DHT11 sensor not detected on pin GP${pin}`);
      }
    }

    resolvedExpr = resolvedExpr.replace(/([a-zA-Z0-9_]+)\.temperature\s*\(\s*\)/g, String(this.globals['temperature'] !== undefined ? this.globals['temperature'] : 24));
    resolvedExpr = resolvedExpr.replace(/([a-zA-Z0-9_]+)\.humidity\s*\(\s*\)/g, String(this.globals['humidity'] !== undefined ? this.globals['humidity'] : 45));

    // Support virtual_dht.DHT11(...) instantiations
    const dhtMatch = resolvedExpr.match(/virtual_dht\.DHT11\s*\(\s*([^)]+)\s*\)/);
    if (dhtMatch) {
      const pinExpr = dhtMatch[1].trim();
      const pinVal = this.evaluateExpression(pinExpr);
      this.globals['dht_pin'] = pinVal;
      return { isSensor: true, type: 'DHT11', pin: pinVal };
    }

    // Support machine.Pin(num, ...) OR bare Pin(num, ...) for MicroPython (from machine import Pin)
    const machinePinMatch = resolvedExpr.match(/(?:machine\.)?Pin\s*\(\s*([^)]+)\s*\)/);
    if (machinePinMatch) {
      const args = machinePinMatch[1].split(',');
      const pinNum = this.evaluateExpression(args[0].trim());
      return { isPin: true, pinNum: pinNum };
    }

    // Support onewire.OneWire(pinObj) — returns a bus mock
    const owMatch = resolvedExpr.match(/onewire\.OneWire\s*\(\s*([^)]+)\s*\)/);
    if (owMatch) {
      const pinObj = this.evaluateExpression(owMatch[1].trim());
      const pinNum = pinObj && pinObj.pinNum !== undefined ? pinObj.pinNum : pinObj;
      return { isBus: true, type: 'OneWire', pin: pinNum };
    }

    // Support ds18x20.DS18X20(busObj) — returns a sensor mock
    const dsMatch = resolvedExpr.match(/ds18x20\.DS18X20\s*\(\s*([^)]+)\s*\)/);
    if (dsMatch) {
      const busObj = this.evaluateExpression(dsMatch[1].trim());
      const pinNum = busObj && busObj.pin !== undefined ? busObj.pin : 15;
      this.globals['ds18b20_pin'] = pinNum;
      return { isSensor: true, type: 'DS18B20', pin: pinNum };
    }

    // Support sensor.scan() — returns a list of ROM addresses
    if (resolvedExpr.match(/([a-zA-Z0-9_]+)\.scan\s*\(\s*\)/)) {
      const pin = this.globals['ds18b20_pin'] !== undefined ? this.globals['ds18b20_pin'] : 15;
      const isConnected = this.onPinRead(String(pin)) === 998;
      return isConnected ? ['28-0000067ff2a'] : [];
    }

    // Support sensor.convert_temp() — no-op
    if (resolvedExpr.match(/([a-zA-Z0-9_]+)\.convert_temp\s*\(\s*\)/)) {
      return undefined;
    }

    // Support sensor.read_temp(rom) — returns tempProbe value
    if (resolvedExpr.match(/([a-zA-Z0-9_]+)\.read_temp\s*\(/)) {
      const pin = this.globals['ds18b20_pin'] !== undefined ? this.globals['ds18b20_pin'] : 15;
      const isConnected = this.onPinRead(String(pin)) === 998;
      if (!isConnected) {
        throw new Error("DS18B20 sensor not detected on pin GP" + pin);
      }
      return this.globals['tempProbe'] !== undefined ? this.globals['tempProbe'] : 25;
    }

    // Support str(val) function call in Python
    let strCount = 0;
    while (resolvedExpr.includes('str(') && strCount++ < 10) {
      const match = resolvedExpr.match(/str\s*\(\s*([^)]+)\s*\)/);
      if (!match) break;
      const innerVal = this.evaluateExpression(match[1]);
      resolvedExpr = resolvedExpr.replace(match[0], `"${String(innerVal)}"`);
    }

    // Support Python f-strings: f"..." or f'...'
    if ((resolvedExpr.startsWith('f"') && resolvedExpr.endsWith('"')) || (resolvedExpr.startsWith("f'") && resolvedExpr.endsWith("'"))) {
      let content = resolvedExpr.slice(2, -1);
      let fCount = 0;
      let fMatch;
      while ((fMatch = content.match(/\{([^}]+)\}/)) && fCount++ < 20) {
        const fullExpr = fMatch[0];
        const innerExpr = fMatch[1];
        const evaluated = this.evaluateExpression(innerExpr);
        content = content.replace(fullExpr, String(evaluated));
      }
      return content;
    }

    // 1. Mock Pin(pin, mode, ...) initialization
    let pinMatch;
    if (resolvedExpr.includes('Pin(') && (pinMatch = resolvedExpr.match(/Pin\s*\(\s*([^,]+)\s*(?:,\s*([^,)]+))?(?:,\s*([^)]+))?\)/))) {
      const pinNumExpr = pinMatch[1].trim();
      const pinNum = this.evaluateExpression(pinNumExpr);
      return { isPin: true, pinNum: pinNum };
    }

    // 2. Mock x.value() reads
    let count = 0;
    while (resolvedExpr.includes('.value()') && count++ < 10) {
      const match = resolvedExpr.match(/([a-zA-Z0-9_]+)\.value\s*\(\s*\)/);
      if (!match) break;
      const varName = match[1];
      const pinObj = this.globals[varName];
      const pinNum = pinObj ? pinObj.pinNum : varName.replace('GP', '');
      const val = this.onPinRead(String(pinNum));
      resolvedExpr = resolvedExpr.replace(match[0], val ? '1' : '0');
    }

    // 3. Preprocess function calls: digitalRead, analogRead, GPIO.input, pulseIn
    count = 0;
    while (resolvedExpr.includes('digitalRead') && count++ < 10) {
      const match = resolvedExpr.match(/digitalRead\s*\(\s*([^)]+)\s*\)/);
      if (!match) break;
      const pin = String(this.evaluateExpression(match[1]));
      const val = this.onPinRead(pin);
      resolvedExpr = resolvedExpr.replace(match[0], val ? '1' : '0');
    }
    
    count = 0;
    while (resolvedExpr.includes('GPIO.input') && count++ < 10) {
      const match = resolvedExpr.match(/GPIO\.input\s*\(\s*([^)]+)\s*\)/);
      if (!match) break;
      const pin = String(this.evaluateExpression(match[1]));
      const val = this.onPinRead(pin);
      resolvedExpr = resolvedExpr.replace(match[0], val ? '1' : '0');
    }
    
    count = 0;
    while (resolvedExpr.includes('analogRead') && count++ < 10) {
      const match = resolvedExpr.match(/analogRead\s*\(\s*([^)]+)\s*\)/);
      if (!match) break;
      const pin = String(this.evaluateExpression(match[1]));
      const val = this.onPinRead(pin);
      resolvedExpr = resolvedExpr.replace(match[0], String(val));
    }
    
    count = 0;
    while (resolvedExpr.includes('pulseIn') && count++ < 10) {
      const match = resolvedExpr.match(/pulseIn\s*\(\s*([^,)]+)\s*,\s*([^)]+)\)/);
      if (!match) break;
      const dist = this.globals['distance'] !== undefined ? this.globals['distance'] : 50;
      const duration = Math.round(dist * 58);
      resolvedExpr = resolvedExpr.replace(match[0], String(duration));
    }
    
    // DHT library mocks
    resolvedExpr = resolvedExpr.replace(/dht\.readTemperature\s*\(\s*\)/g, String(this.globals['temperature'] !== undefined ? this.globals['temperature'] : 24));
    resolvedExpr = resolvedExpr.replace(/dht\.readHumidity\s*\(\s*\)/g, String(this.globals['humidity'] !== undefined ? this.globals['humidity'] : 45));

    // millis() mock
    resolvedExpr = resolvedExpr.replace(/millis\s*\(\s*\)/g, String(Date.now()));

    resolvedExpr = resolvedExpr.trim();
    if (resolvedExpr === 'HIGH' || resolvedExpr === 'true' || resolvedExpr === 'True') return true;
    if (resolvedExpr === 'LOW' || resolvedExpr === 'false' || resolvedExpr === 'False') return false;
    
    // Check if it's numeric
    if (/^-?\d+(\.\d+)?$/.test(resolvedExpr)) {
      return Number(resolvedExpr);
    }

    // Check strings
    if ((resolvedExpr.startsWith('"') && resolvedExpr.endsWith('"')) || (resolvedExpr.startsWith("'") && resolvedExpr.endsWith("'"))) {
      return resolvedExpr.slice(1, -1);
    }

    // Substitute variables from scopes
    const combinedScope = { ...this.globals, ...this.locals };
    
    // Sort variables by length descending to prevent replacing substrings (e.g. ledPin13 vs ledPin)
    const varNames = Object.keys(combinedScope).sort((a, b) => b.length - a.length);

    // Replace known variables
    for (const name of varNames) {
      // Use regex with word boundaries to replace variable exact matches only
      const escapedName = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedName}\\b`, 'g');
      const val = combinedScope[name];
      const stringified = typeof val === 'string' ? `"${val}"` : String(val);
      resolvedExpr = resolvedExpr.replace(regex, stringified);
    }

    // Replace some Arduino/Python conventions
    resolvedExpr = resolvedExpr.replace(/==/g, '===');
    resolvedExpr = resolvedExpr.replace(/!=/g, '!==');
    resolvedExpr = resolvedExpr.replace(/\band\b/g, '&&');
    resolvedExpr = resolvedExpr.replace(/\bor\b/g, '||');
    resolvedExpr = resolvedExpr.replace(/\bnot\b/g, '!');

    try {
      // Simple, sandboxed eval using Function constructor
      // Since it's run on processed code (replaced variables and constants), it's relatively safe
      const result = new Function(`return (${resolvedExpr});`)();
      return result;
    } catch (e) {
      // Fallback: if eval fails, check if the expression itself is a variable
      if (combinedScope[expr] !== undefined) {
        return combinedScope[expr];
      }
      return expr;
    }
  }

  // Step one line of execution
  public step() {
    // Loop back for python while blocks BEFORE end-of-program check
    if (this.platform === 'Raspberry Pi' && this.whileStartPc !== -1 && this.pc === this.whileEndPc + 1) {
      this.pc = this.whileStartPc;
    }

    if (this.pc >= this.parsedLines.length) {
      if (this.platform === 'Arduino' && this.loopStartPc !== -1) {
        // Loop back
        this.pc = this.loopStartPc + 1;
        this.isArduinoLooping = true;
        this.onStateChange();
        return;
      }
      // For Python, loop back if we have a while block
      if (this.platform === 'Raspberry Pi' && this.whileStartPc !== -1) {
        this.pc = this.whileStartPc;
      } else {
        this.running = false;
        this.onSerialLog("[Simulation ended]");
        this.onStateChange();
        return;
      }
    }

    const currentLine = this.parsedLines[this.pc];
    const lineText = currentLine.text;

    // Check if breakpoint matches this original line number
    if (this.breakpoints.has(currentLine.originalLineNum) && !this.paused) {
      this.paused = true;
      this.onSerialLog(`[Breakpoint hit at line ${currentLine.originalLineNum}]`);
      this.onStateChange();
      return;
    }

    this.paused = false;

    try {
      this.executeLine(lineText);
    } catch (error: any) {
      let foundExcept = false;
      if (this.platform === 'Raspberry Pi') {
        for (let i = this.pc + 1; i < this.parsedLines.length; i++) {
          const l = this.parsedLines[i].text.trim();
          if (l.startsWith('except')) {
            this.pc = i;
            foundExcept = true;
            const exceptMatch = l.match(/except\s+\w+\s+as\s+([a-zA-Z0-9_]+)\s*:/);
            if (exceptMatch) {
              const varName = exceptMatch[1];
              this.globals[varName] = error.message;
            }
            break;
          }
        }
      }
      if (!foundExcept) {
        console.error("ENGINE CRASH DUMP: ", error);
        this.onSerialLog(`[Error line ${currentLine.originalLineNum}]: ${error.message}`);
        this.running = false;
        this.onStateChange();
        return;
      }
    }

    // Advance PC
    this.pc++;

    // Check if we hit the boundaries of Arduino setup/loop
    if (this.platform === 'Arduino') {
      if (this.pc > this.setupEndPc && !this.isSetupDone && this.setupStartPc !== -1) {
        this.isSetupDone = true;
        if (this.loopStartPc !== -1) {
          this.pc = this.loopStartPc + 1;
          this.isArduinoLooping = true;
        } else {
          this.running = false;
        }
      } else if (this.pc > this.loopEndPc && this.isArduinoLooping) {
        // Restart loop
        this.pc = this.loopStartPc + 1;
      }
    }

    // Python while-loop boundary: loop back after advancing past the block
    if (this.platform === 'Raspberry Pi' && this.whileStartPc !== -1 && this.pc === this.whileEndPc + 1) {
      this.pc = this.whileStartPc;
    }

    this.onStateChange();
  }

  private executeLine(line: string) {
    // Clean and remove trailing semicolons
    const cleanLine = line.endsWith(';') ? line.slice(0, -1).trim() : line;

    // 1. Variable Assignments
    // Arduino: int led = 13; float value = 2.4;
    // Python: led = 13
    const varDeclMatch = cleanLine.match(/^(?:int|float|double|char|const\s+int|boolean|String)\s+([a-zA-Z0-9_]+)\s*=\s*(.+)$/);

    if (varDeclMatch) {
      const varName = varDeclMatch[1].trim();
      const valExpr = varDeclMatch[2].trim();
      this.globals[varName] = this.evaluateExpression(valExpr);
      return;
    }

    // Python assignments or general re-assignments (supporting += and -=)
    const pyAssignMatch = cleanLine.match(/^([a-zA-Z0-9_]+)\s*(\+|-)?=\s*(.+)$/);
    if (pyAssignMatch) {
      const varName = pyAssignMatch[1].trim();
      const op = pyAssignMatch[2];
      const valExpr = pyAssignMatch[3].trim();

      // Exclude function headers or control words
      if (!['if', 'while', 'for', 'def', 'elif'].includes(varName)) {
        if (op) {
          const currentVal = this.globals[varName] !== undefined ? this.globals[varName] : 0;
          this.globals[varName] = this.evaluateExpression(`${currentVal} ${op} (${valExpr})`);
        } else {
          this.globals[varName] = this.evaluateExpression(valExpr);
        }
        return;
      }
    }

    // 2. Control Flow: If statements
    // Arduino: if (val == HIGH) {
    // Python: if val == True:
    const arduinoIfMatch = cleanLine.match(/^if\s*\((.+)\)\s*\{?$/);
    const pythonIfMatch = cleanLine.match(/^if\s+(.+)\s*:\s*$/);

    if (arduinoIfMatch || pythonIfMatch) {
      const condition = (arduinoIfMatch ? arduinoIfMatch[1] : pythonIfMatch![1]).trim();
      const isTrue = this.evaluateExpression(condition);
      this.lastIfResult = !!isTrue;
      
      if (!isTrue) {
        // Skip statements inside this block!
        // We find the matching closing brace for C++ or the next line with same/less indentation for Python.
        if (this.platform === 'Arduino') {
          this.skipArduinoBlock();
        } else {
          this.skipPythonBlock();
        }
      }
      return;
    }

    // Python else: block — skip if the preceding if was taken
    if (cleanLine === 'else:') {
      if (this.lastIfResult) {
        // The if-block was executed, so skip the else-block
        this.skipPythonBlock();
      }
      // If lastIfResult is false, the if was skipped, so execute the else body
      return;
    }

    // Python while loop statements
    const pythonWhileMatch = cleanLine.match(/^while\s+(.+)\s*:\s*$/);
    if (pythonWhileMatch) {
      const condition = pythonWhileMatch[1].trim();
      const isTrue = this.evaluateExpression(condition);
      if (!isTrue) {
        this.skipPythonBlock();
      }
      return;
    }

    // Python except statements (Skip except blocks in normal execution since we assume no errors occur)
    if (cleanLine.match(/^except(?:\s+.*)?:\s*$/)) {
      this.skipPythonBlock();
      return;
    }

    // Python try statements (Do nothing, just execute the try block)
    if (cleanLine === 'try:') {
      return;
    }

    // Python/Arduino function definitions (def / async def / void / etc.) — skip the definition block
    if (cleanLine.match(/^(?:async\s+)?def\s+[a-zA-Z0-9_]+\s*\(/) || cleanLine.match(/^(?:void|int|float|double|char|boolean|String)\s+[a-zA-Z0-9_]+\s*\(/)) {
      if (this.platform === 'Raspberry Pi') {
        this.skipPythonBlock();
      } else {
        this.skipArduinoBlock();
      }
      return;
    }

    // Support asyncio.run(func_name())
    const asyncioRunMatch = cleanLine.match(/asyncio\.run\s*\(\s*([a-zA-Z0-9_]+)\s*\(\s*\)\s*\)/);
    if (asyncioRunMatch) {
      const funcName = asyncioRunMatch[1].trim();
      const declIndex = this.parsedLines.findIndex(line => {
        const t = line.text.trim();
        return t.startsWith(`def ${funcName}`) || t.startsWith(`async def ${funcName}`);
      });
      if (declIndex !== -1) {
        // Set PC to the first line inside the function body
        this.pc = declIndex + 1;
        return;
      }
    }

    // Handle single closing braces
    if (cleanLine === '}') {
      return; // Do nothing, just boundary
    }

    // 3. API Commands: digitalWrite(pin, value) / GPIO.output(pin, value) / pin.value(value)
    const dwMatch = cleanLine.match(/digitalWrite\s*\(\s*([^,]+)\s*,\s*([^\)]+)\)/);
    const pyOutputMatch = cleanLine.match(/GPIO\.output\s*\(\s*([^,]+)\s*,\s*([^\)]+)\)/);
    const pyPinValMatch = cleanLine.match(/^([a-zA-Z0-9_]+)\.value\s*\(\s*([^\)]+)\s*\)/);
    
    if (dwMatch || pyOutputMatch || pyPinValMatch) {
      if (pyPinValMatch) {
        const varName = pyPinValMatch[1].trim();
        const valExpr = pyPinValMatch[2].trim();
        const pinObj = this.globals[varName];
        if (pinObj && pinObj.isPin) {
          const val = this.evaluateExpression(valExpr);
          this.onPinWrite(String(pinObj.pinNum), val);
          return;
        }
      } else {
        const pinExpr = (dwMatch ? dwMatch[1] : pyOutputMatch![1]).trim();
        const valExpr = (dwMatch ? dwMatch[2] : pyOutputMatch![2]).trim();

        const pin = String(this.evaluateExpression(pinExpr));
        const val = this.evaluateExpression(valExpr);
        this.onPinWrite(pin, val);
        return;
      }
    }

    // pinMode(pin, mode) / GPIO.setup(pin, mode)
    const pmMatch = cleanLine.match(/pinMode\s*\(\s*([^,]+)\s*,\s*([^\)]+)\)/);
    const pySetupMatch = cleanLine.match(/GPIO\.setup\s*\(\s*([^,]+)\s*,\s*([^\)]+)\)/);
    if (pmMatch || pySetupMatch) {
      const pinExpr = (pmMatch ? pmMatch[1] : pySetupMatch![1]).trim();
      const modeExpr = (pmMatch ? pmMatch[2] : pySetupMatch![2]).trim();

      const pin = String(this.evaluateExpression(pinExpr));
      const mode = this.evaluateExpression(modeExpr);
      this.pinModes[pin] = mode;
      return;
    }

    // delay(ms) / time.sleep(seconds) / await asyncio.sleep(seconds) / time.sleep_ms(ms)
    const delayMatch = cleanLine.match(/delay\s*\(\s*([^\)]+)\)/);
    const sleepMatch = cleanLine.match(/(?:time\.sleep|await\s+asyncio\.sleep)\s*\(\s*([^\)]+)\)/);
    const sleepMsMatch = cleanLine.match(/time\.sleep_ms\s*\(\s*([^\)]+)\)/);
    if (delayMatch || sleepMatch || sleepMsMatch) {
      const durExpr = (delayMatch ? delayMatch[1] : sleepMatch ? sleepMatch[1] : sleepMsMatch![1]).trim();
      const rawDur = this.evaluateExpression(durExpr);
      // delay() and sleep_ms() are in ms; time.sleep() is in seconds
      const ms = sleepMatch ? Number(rawDur) * 1000 : Number(rawDur);
      this.delayUntil = Date.now() + ms;
      return;
    }

    // Serial.begin(baud) / GPIO.setmode / etc. (Config lines)
    if (cleanLine.startsWith('Serial.begin') || cleanLine.startsWith('GPIO.setmode') || cleanLine.startsWith('GPIO.setwarnings') || cleanLine.startsWith('import ') || cleanLine.startsWith('from ')) {
      return; // Skip config setup statements in execution but allow them
    }

    // Serial.println(msg) / Serial.print(msg) / print(msg)
    const printMatch = cleanLine.match(/Serial\.print(?:ln)?\s*\(\s*(.+)\s*\)/);
    const pyPrintMatch = cleanLine.match(/^print\s*\(\s*(.+)\s*\)/);
    if (printMatch || pyPrintMatch) {
      const contentExpr = (printMatch ? printMatch[1] : pyPrintMatch![1]).trim();
      const val = this.evaluateExpression(contentExpr);
      this.onSerialLog(String(val));
      return;
    }

    // 4. Special Custom Library Handlers (DHT, Motors, LCD)
    // DHT read: float t = dht.readTemperature();
    // In templates we assign variables to these. If a line calls them directly, or they are in an assignment:
    // e.g. "t = dht.readTemperature()" is handled by the assignment evaluator because we can inject variables!
    // We will inject sensor values as active variables in the globals list during simulator run loop (e.g. temperature, humidity, light, distance).
  }

  // Skips execution to matching brace for Arduino
  private skipArduinoBlock() {
    let braceCount = 1;
    let index = this.pc + 1;
    while (index < this.parsedLines.length && braceCount > 0) {
      const text = this.parsedLines[index].text;
      for (const ch of text) {
        if (ch === '{') braceCount++;
        if (ch === '}') braceCount--;
      }
      if (braceCount === 0) {
        this.pc = index; // Move PC to the closing brace
        return;
      }
      index++;
    }
  }

  // Skips execution based on indentation level for Python
  private skipPythonBlock() {
    // Find indentation level of next line. Python parsing checks whitespace.
    // However, our preprocessor stripped white spaces! So let's look at indentation of original lines.
    const currentLineNum = this.parsedLines[this.pc].originalLineNum;
    const currentIndent = this.getIndentation(currentLineNum);

    let index = this.pc + 1;
    while (index < this.parsedLines.length) {
      const lineNum = this.parsedLines[index].originalLineNum;
      const indent = this.getIndentation(lineNum);
      if (indent <= currentIndent) {
        this.pc = index - 1; // Move PC to just before this line
        return;
      }
      index++;
    }
    this.pc = this.parsedLines.length - 1;
  }

  private getIndentation(lineNum: number): number {
    const rawLines = this.code.split('\n');
    if (lineNum - 1 < 0 || lineNum - 1 >= rawLines.length) return 0;
    const line = rawLines[lineNum - 1];
    const match = line.match(/^(\s*)/);
    return match ? match[1].length : 0;
  }
}
