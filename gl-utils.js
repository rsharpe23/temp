const ShaderElementUtil = (() => {
  const findShaderType = elemType => {
    return elemType.trim().match(/x-shader\/x-(\D+)/)[1];
  };

  return {
    getType(elem) {
      let shaderType = findShaderType(elem.type);
      shaderType = shaderType.toUpperCase();
      return `${shaderType}_SHADER`;
    },
  };
})();

function getShaderFromElem(gl, elemId) {
  const elem = document.getElementById(elemId);
  const elemType = ShaderElementUtil.getType(elem);
  return createShader(gl, gl[elemType], elem.text);
}

function createShader(gl, type, text) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, text);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    throw new Error('Incorrect shader compile');
  }

  return shader;
}

function createProgram(gl) {
  const vs = getShaderFromElem(gl, 'shader-vs');
  const fs = getShaderFromElem(gl, 'shader-fs');
  return createProgramBy(gl, vs, fs);
}

function createProgramBy(gl, vertShader, fragShader) {
  const program = gl.createProgram();
  gl.attachShader(program, vertShader);
  gl.attachShader(program, fragShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error('Incorrect program link');
  }

  return program;
}

function createBuffer(gl, target, data) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(target, buffer);
  gl.bufferData(target, data, gl.STATIC_DRAW);
  return buffer;
}