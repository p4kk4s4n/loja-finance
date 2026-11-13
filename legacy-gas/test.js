function parseFlexibleNumber(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  let str = val.toString().trim();
  const commas = (str.match(/,/g) || []).length;
  const periods = (str.match(/\./g) || []).length;
  if (commas > 0 && periods > 0) {
    const lastComma = str.lastIndexOf(',');
    const lastDot = str.lastIndexOf('.');
    if (lastComma > lastDot) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  } else if (commas > 0) {
    if (commas > 1) {
      str = str.replace(/,/g, '');
    } else {
      const parts = str.split(',');
      if (parts[1].length === 3) str = str.replace(',', '');
      else str = str.replace(',', '.');
    }
  } else if (periods > 0) {
    if (periods > 1) {
      str = str.replace(/\./g, '');
    }
  }
  str = str.replace(/[^\d.-]/g, '');
  return parseFloat(str) || 0;
}
console.log(parseFlexibleNumber('2.345,67')); // 2345.67
console.log(parseFlexibleNumber('2,345.67')); // 2345.67
console.log(parseFlexibleNumber('2,345')); // 2345
console.log(parseFlexibleNumber('1,000,000')); // 1000000
console.log(parseFlexibleNumber('1.000.000')); // 1000000
console.log(parseFlexibleNumber('2.345')); // 2.345 (Wait! Is 2.345 supposed to be 2345?)
